"""Credential-free, allowlisted detailed renderer using the existing dashboard UI.

Reads only local snapshots/config/template. No writes, SSH or publication. Identity
fields require an explicit caller opt-in. Hidden source metadata is never copied.
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import json
import math
from pathlib import Path
import re

UTC = dt.timezone.utc
ORDER = ("sg", "carbon", "oxygen")
NUMERIC = set("rank jobs count_lower_bound count_upper_bound logical_started_jobs requeue_records_collapsed no_actual_start low_space_filesystems size_bytes total_bytes used_bytes available_bytes slurm_cpus_allocated slurm_cpus_total node_count nodes_with_allocations memory_total_bytes allocated_gpus configured_gpus visible_job_count sockets cores_per_socket threads_per_core memory_allocated_bytes slurm_free_memory_bytes slurm_cpus latest_job_id MaxJobId physical_cores logical_cpus memory_available_gib memory_total_gib socket physical_core logical_cpu utilization_percent index memory_free_gib cpu_TFLOPS gpu_TFLOPS base_GHz fp32_TFLOPS fp64_TFLOPS".split())
BOOLEANS = {"lineage_inferred", "all_users_visible", "jobs_truncated", "queue", "gpu_query_ok"}
NUMERIC.update({"RUNNING", "PENDING", "use_percent"})
STRING_LISTS = {"nodes", "partitions", "mounts"}


def _stamp(value):
    if not isinstance(value, str):
        return None
    try:
        stamp = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return stamp.astimezone(UTC) if stamp.tzinfo else None
    except ValueError:
        return None


def _pick(value, *keys):
    result = {}
    for key in keys:
        if key not in value:
            continue
        item = value[key]
        if key in NUMERIC:
            valid = item is None or (type(item) in (int, float) and math.isfinite(item))
        elif key in BOOLEANS:
            valid = isinstance(item, bool)
        elif key in STRING_LISTS:
            valid = isinstance(item, list) and all(isinstance(v, str) for v in item)
            item = list(item) if valid else item
        else:
            valid = item is None or isinstance(item, str)
        if not valid:
            raise ValueError("Invalid dashboard field type: " + key)
        result[key] = item
    return result


def _module(root, filename):
    spec = importlib.util.spec_from_file_location("_detailed_" + filename, root / (filename + ".py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _name(value, fallback="Unknown"):
    if not isinstance(value, str):
        return fallback
    return re.sub(r"[\x00-\x1f\x7f]", "", value)[:180]


def _missing_name(value):
    return not isinstance(value, str) or not _name(value).strip()


def _program(value):
    # Executable basenames are visible in the original UI; filesystem paths are not.
    return _name(value.replace("\\", "/").rstrip("/").rsplit("/", 1)[-1]) if isinstance(value, str) else "Unknown"


def _ranking(value):
    if not isinstance(value, dict):
        return None
    return {"rows": [{"rank": None, "jobs": 0, **_pick(r, "rank", "jobs"), "name": _name(r.get("name")),
                      "name_missing": _missing_name(r.get("name"))}
                     for r in value.get("rows", [])]}


def _usage(value, include_identities):
    if not include_identities or not isinstance(value, dict):
        return None
    h = value.get("historical", {})
    result = {"disclosure": "approved", **_pick(value, "all_users_visible"),
              "accounting_config": _pick(value.get("accounting_config", {}), "PurgeJobAfter", "PurgeStepAfter"),
              "historical": _pick(h, "status", "first_retained_start", "last_retained_start", "lineage_inferred",
                                  "count_lower_bound", "count_upper_bound")}
    out = result["historical"]
    out["audit"] = _pick(h.get("audit", {}), "logical_started_jobs", "requeue_records_collapsed", "no_actual_start")
    out["top5"] = _ranking(h.get("top5") or h.get("all_period", {}).get("User"))
    if "last_month" in h:
        out["last_month"] = {**_pick(h["last_month"], "month"), "ranking": _ranking(h["last_month"].get("ranking"))}
    else:
        asof = _stamp(h.get("as_of"))
        month = ((asof.astimezone(dt.timezone(dt.timedelta(hours=9))).replace(day=1) - dt.timedelta(days=1)).strftime("%Y-%m")
                 if asof else None)
        match = next((r for r in h.get("monthly", []) if r.get("month") == month), {})
        out["last_month"] = {"month": month, "ranking": _ranking(match.get("User"))}
    return result


def _storage_label(value):
    value = _name(value)
    if (value.startswith("//") or ":" in value or
            re.search(r"(?:\d{1,3}\.){3}\d{1,3}", value)):
        return "Network volume"
    return value


def _storage(value, include_identities=False):
    if not isinstance(value, dict):
        return {"status": "unavailable"}
    result = _pick(value, "status", "low_space_filesystems", "scope", "checked_at_utc")
    result["disks"] = [{"device": _storage_label(d.get("device")) if include_identities else "Drive " + str(i + 1),
                        **_pick(d, "size_bytes", "media")}
                       for i, d in enumerate(value.get("disks", []))]
    result["volumes"] = []
    for i, v in enumerate(value.get("volumes", [])):
        mounts = _pick(v, "mounts").get("mounts", [])
        result["volumes"].append({"device": _storage_label(v.get("device")) if include_identities else "Volume " + str(i + 1),
                                  "mounts": [_storage_label(m) for m in mounts] if include_identities else [],
                                  **_pick(v, "fstype", "mount_access", "status", "size_bytes", "total_bytes",
                                          "used_bytes", "available_bytes", "space_status", "scope", "use_percent")})
    return result


def project_row(row, *, include_identities=False, occupancy=None):
    """Strict projection. Return neither source dictionaries nor hidden metadata."""
    result = _pick(row, "host", "kind", "status", "local_completed_at_utc")
    if row.get("kind") == "slurm_cluster":
        result["storage"] = _storage(row.get("storage"), include_identities)
        result.update(_pick(row, "slurm_cpus_allocated", "slurm_cpus_total", "node_count", "nodes_with_allocations",
                            "memory_total_bytes", "allocated_gpus", "configured_gpus", "visible_job_count", "jobs_truncated"))
        result["query_ok"] = _pick(row.get("query_ok", {}), "queue")
        result["job_states"] = _pick(row.get("job_states", {}), "RUNNING", "PENDING")
        queue_ok = result["query_ok"].get("queue") is True
        result["nodes"] = []
        for n in row.get("nodes", []):
            item = _pick(n, "name", "state", "partitions", "slurm_cpus_allocated", "slurm_cpus_total", "sockets",
                         "cores_per_socket", "threads_per_core", "memory_allocated_bytes", "memory_total_bytes",
                         "slurm_free_memory_bytes", "allocated_gpus", "configured_gpus")
            item["job_labels"] = [{"id": _name(j.get("id")), "name": _name(j.get("name")) if include_identities else "Job",
                                   "name_missing": include_identities and _missing_name(j.get("name")),
                                   "id_missing": _missing_name(j.get("id"))}
                                  for j in n.get("job_labels", [])] if queue_ok else []
            result["nodes"].append(item)
        result["jobs"] = [{"id": _name(j.get("id")), "name": _name(j.get("name")) if include_identities else "Job",
                           "name_missing": include_identities and _missing_name(j.get("name")),
                           "id_missing": _missing_name(j.get("id")),
                           **_pick(j, "state", "slurm_cpus", "nodes")} for j in row.get("jobs", [])] if queue_ok else []
        if row.get("job_counter"):
            result["job_counter"] = _pick(row["job_counter"], "status", "latest_job_id", "MaxJobId", "checked_at_utc")
        usage = _usage(row.get("usage"), include_identities)
        if usage:
            result["usage"] = usage
    else:
        result.update(_pick(row, "physical_cores", "logical_cpus", "memory_available_gib", "memory_total_gib", "gpu_query_ok"))
        result["occupancy"] = occupancy or {"cpu": {"known": False}, "gpu": {"known": False}}
        result["cpu_threads"] = []
        if result["occupancy"].get("cpu", {}).get("known"):
            for t in row.get("cpu_threads", []):
                item = _pick(t, "socket", "physical_core", "logical_cpu", "utilization_percent")
                item["programs"] = [_program(p) for p in t.get("programs", [])] if include_identities else []
                item["program_names_missing"] = [_missing_name(p) for p in t.get("programs", [])] if include_identities else []
                result["cpu_threads"].append(item)
        result["gpus"] = []
        if row.get("gpu_query_ok"):
            for g in row.get("gpus", []):
                item = _pick(g, "index", "name", "memory_free_gib", "memory_total_gib", "utilization_percent")
                item["processes"] = [{"name": _program(p.get("name", "Unknown")),
                                      "name_missing": _missing_name(p.get("name"))} for p in g.get("processes", [])] if include_identities else []
                result["gpus"].append(item)
        result["storage"] = _storage(row.get("storage"), include_identities)
    return result


def _performance(config, key):
    result = {}
    for host in ORDER:
        src = config.get(key, {}).get(host)
        if not isinstance(src, dict):
            continue
        result[host] = _pick(src, "cpu_TFLOPS", "gpu_TFLOPS")
        if key == "nominal_fp32" and host == "sg":
            result[host]["node_groups"] = [_pick(g, "nodes", "cpu_model", "base_GHz", "fp32_TFLOPS", "fp64_TFLOPS")
                                            for g in src.get("node_groups", [])]
    return result


def _replace(text, before, after):
    if text.count(before) != 1:
        raise ValueError("Existing dashboard template changed; review required: " + before[:60])
    return text.replace(before, after, 1)


def render(root, payload):
    """Reuse the dashboard layout with freshness fixes and bilingual public UI."""
    root = Path(root)
    template = (root / "dashboard_template.html").read_text(encoding="utf-8")
    localize = _module(root, "localize_dashboard")
    localize.EN["cumulativeReview"] = ""
    localize.EN["sampleNote"] = "Observed activity, not scheduler reservations."
    html = localize.english_template(template)
    html = _replace(html, "*{box-sizing:border-box}", "[hidden]{display:none!important}*{box-sizing:border-box}")
    html = _replace(html, "<title>Oxygen / Carbon</title>", '<meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Compute resources</title>')
    html = _replace(html, "gb=n=>n*1073741824/1e9", "gb=n=>Number.isFinite(n)?n*1073741824/1e9:NaN")
    old_time = "const time=s=>new Intl.DateTimeFormat(document.documentElement.lang==='en'?'en-GB':'ko-KR',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s));"
    freshness = """const instant=s=>typeof s==='string'&&/(?:Z|[+-]\\d{2}:\\d{2})$/.test(s)?Date.parse(s):NaN;
const freshRow=r=>{const stamp=instant(r?.local_completed_at_utc),age=(Date.now()-stamp)/60000;return r?.status==='ok'&&Number.isFinite(stamp)&&age>=-5&&age<=data.stale_after_minutes;};
const time=s=>Number.isFinite(instant(s))?new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(s)):'Unknown';"""
    html = _replace(html, old_time, freshness)
    html = _replace(html, "const displayHost=host=>host==='sg'?'SG-Master':host;", "const displayHost=host=>({sg:'SG Cluster',carbon:'Carbon',oxygen:'Oxygen'})[host]||host;")
    html = _replace(html, "return {s,c:s.latest.status==='ok'?s.latest:s.last_good};", "return {s,c:freshRow(s.latest)?s.latest:null};")
    start = html.index("function stateLine(")
    end = html.index("\nfunction details(", start)
    html = html[:start] + """function stateLine(s,c){const l=s.latest;let state=labels.ok,warning=false;if(l.status!=='ok'){state=labels.failed;warning=true;}else if(!freshRow(l)){state=labels.stale;warning=true;}else if(l.kind==='slurm_cluster'&&!l.query_ok?.queue){state=labels.queueFailed;warning=true;}else if(l.kind!=='slurm_cluster'&&!l.gpu_query_ok){state=labels.gpuFailed;warning=true;}return {text:time(l.local_completed_at_utc)+' KST · '+state,warning};}""" + html[end:]
    html = _replace(html, "const fresh=s.latest.status==='ok'&&(Date.now()-new Date(s.latest.local_completed_at_utc))/60000<=data.stale_after_minutes;", "const fresh=freshRow(s.latest);")
    html = _replace(html, "if(!c){byId('cluster-jobs')", "byId('selection').hidden=!c;if(!c){byId('cluster-jobs')")
    html = _replace(html, "fresh&&j.status==='ok'&&Number.isSafeInteger(j.latest_job_id)", "fresh&&freshRow({status:j.status,local_completed_at_utc:j.checked_at_utc})&&Number.isSafeInteger(j.latest_job_id)")
    html = _replace(html, "+' KST<br>'+esc(labels.cumulativeReview)", "+' KST'")
    html = _replace(html, "const jobs=byId('cluster-jobs');jobs.hidden=false;", "const jobs=byId('cluster-jobs');jobs.hidden=false;if(!queueFresh){jobs.innerHTML='<p class=\"warning-message\">'+esc(labels.queueFailed)+'</p>';return;}")
    html = html.replace("labels.noAssignedJobs", "(cQueryFresh()?labels.noAssignedJobs:labels.unknown)")
    # nodeDetails has no local c; consult the selected fresh row for queue state.
    html = _replace(html, "let nodeMap=new Map();", "let nodeMap=new Map();\nfunction cQueryFresh(){return current().c?.query_ok?.queue===true;}")
    html = _replace(html, "render();setInterval(()=>{const {s,c}=current(),state=stateLine(s,c);byId('status').textContent=state.text;byId('status').className='status'+(state.warning?' warning':'');},60000);", "render();setInterval(render,60000);")
    from bilingual_dashboard import bilingual_template
    html = bilingual_template(html, localize)
    embedded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), allow_nan=False).replace("<", "\\u003c")
    html = html.replace("RESOURCE_JSON_PAYLOAD", embedded)
    if len(html.encode("utf-8")) > 200 * 1024:
        raise ValueError("Detailed dashboard exceeds 200 KiB")
    return html.encode("utf-8")


def build(root, include_identities=False, now=None, collection_failed=False):
    """Return complete HTML bytes and UTC generation timestamp; never publish."""
    root = Path(root)
    now = now or dt.datetime.now(UTC)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    generated_at = now.astimezone(UTC).isoformat()
    latest = json.loads((root / "latest.json").read_text(encoding="utf-8-sig"))
    config = json.loads((root / "config.json").read_text(encoding="utf-8-sig"))
    stale_after = config.get("stale_after_minutes", 90)
    if type(stale_after) not in (int, float) or not math.isfinite(stale_after) or not 0 < stale_after <= 1440:
        raise ValueError("Invalid stale interval")
    occupancy = _module(root, "occupancy")
    source = {r["host"]: r for r in latest.get("servers", []) + latest.get("clusters", [])}
    servers = []
    for host in ORDER:
        row = source.get(host, {"host": host, "status": "failed", "local_completed_at_utc": generated_at})
        counts = occupancy.with_occupancy(row).get("occupancy") if host != "sg" else None
        safe = project_row(row, include_identities=include_identities, occupancy=counts)
        if collection_failed:
            safe["status"] = "failed"
        servers.append({"host": host, "latest": safe, "last_good": None})
    payload = {"host": "sg", "servers": servers, "history": [], "generated_at": generated_at,
               "stale_after_minutes": stale_after,
               "nominal_fp32": _performance(config, "nominal_fp32"),
               "nominal_fp64": _performance(config, "nominal_fp64")}
    return {"html": render(root, payload), "generated_at": generated_at}
