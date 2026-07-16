// Single source of truth for News and Publications, shared by
// News.dc.html, Publications.dc.html, and MTAP Landing.dc.html.
// Edit here once; every page stays in sync.

if (!window.MTAP_FEED) { (function(){
const JU = {
  ijc: 'https://onlinelibrary.wiley.com/journal/18695868',
  jcp: 'https://pubs.aip.org/aip/jcp',
  cej: 'https://www.sciencedirect.com/journal/chemical-engineering-journal',
  ncs: 'https://www.nature.com/natcomputsci/',
  aem: 'https://onlinelibrary.wiley.com/journal/16146840',
  cpc: 'https://www.sciencedirect.com/journal/computer-physics-communications',
  msde: 'https://pubs.rsc.org/en/journals/journalissues/me',
  iecr: 'https://pubs.acs.org/journal/iecred',
  lang: 'https://pubs.acs.org/journal/langd5',
  spt: 'https://www.sciencedirect.com/journal/separation-and-purification-technology',
  jacs: 'https://pubs.acs.org/journal/jacsat',
  jms: 'https://www.sciencedirect.com/journal/journal-of-membrane-science',
  matter: 'https://www.cell.com/matter/home',
  afm: 'https://onlinelibrary.wiley.com/journal/16163028',
  ami: 'https://pubs.acs.org/journal/aamick',
  jctc: 'https://pubs.acs.org/journal/jctcce',
  rkmc: 'https://link.springer.com/journal/11144',
  am: 'https://onlinelibrary.wiley.com/journal/15214095',
  jec: 'https://www.sciencedirect.com/journal/journal-of-energy-chemistry',
  jpca: 'https://pubs.acs.org/journal/jpcafh',
  ne: 'https://www.nature.com/nenergy/',
  kjche: 'https://link.springer.com/journal/11814',
  advsci: 'https://onlinelibrary.wiley.com/journal/21983844',
  sciadv: 'https://www.science.org/journal/sciadv',
  cm: 'https://pubs.acs.org/journal/cmatex',
  jpcc: 'https://pubs.acs.org/journal/jpccck',
  jmca: 'https://pubs.rsc.org/en/journals/journalissues/ta',
  joss: 'https://joss.theoj.org/',
  cattoday: 'https://www.sciencedirect.com/journal/catalysis-today',
  ijhe: 'https://www.sciencedirect.com/journal/international-journal-of-hydrogen-energy',
  bkcs: 'https://onlinelibrary.wiley.com/journal/12295949',
  acsanm: 'https://pubs.acs.org/journal/aanmf6',
  ijis: 'https://onlinelibrary.wiley.com/journal/1098111x',
  ct: 'https://www.cleantech.or.kr/ct/',
  jpcl: 'https://pubs.acs.org/journal/jpclcd',
  ace: 'https://www.cheric.org/research/tech/periodicals/journal.php?jourid=250',
  jml: 'https://www.sciencedirect.com/journal/journal-of-molecular-liquids',
  acb: 'https://www.sciencedirect.com/journal/applied-catalysis-b-environmental',
  jced: 'https://pubs.acs.org/journal/jceaax',
  molsim: 'https://www.tandfonline.com/journals/gmos20',
  acssce: 'https://pubs.acs.org/journal/ascecg',
  ccr: 'https://www.sciencedirect.com/journal/coordination-chemistry-reviews',
  cjc: 'https://www.sciencedirect.com/journal/chinese-journal-of-catalysis',
  chemsel: 'https://chemistry-europe.onlinelibrary.wiley.com/journal/23656549',
  jco2: 'https://www.sciencedirect.com/journal/journal-of-co2-utilization',
  chemsci: 'https://pubs.rsc.org/en/journals/journalissues/sc',
  ees: 'https://pubs.rsc.org/en/journals/journalissues/ee',
  jpsb: 'https://onlinelibrary.wiley.com/journal/10990488',
  jpcb: 'https://pubs.acs.org/journal/jpcbfk',
  macromol: 'https://pubs.acs.org/journal/mamobx'
};

const MN = { '01': 'January', '02': 'February', '03': 'March', '04': 'April', '05': 'May', '06': 'June', '07': 'July', '08': 'August', '09': 'September', '10': 'October', '11': 'November', '12': 'December' };

const P = (t, a) => ({ t, person: true, href: 'People.dc.html#' + a });
const J = (t, k, doi) => ({ t, journal: true, href: doi ? 'https://doi.org/' + doi : JU[k] });
const B = (t) => ({ t, b: true });
const norm = (parts) => parts.flatMap(s => {
  if (typeof s !== 'string') return [s];
  return s.split(/(Congratulations!|Welcome!)/).filter(Boolean).map(x => /^(Congratulations!|Welcome!)$/.test(x) ? { t: x, hl: true } : { t: x, plain: true });
});

// Newest first. { y: year, m: 2-digit month, parts: [...] }
const NEWS_RAW = [
  { y: '2026', m: '05', parts: [P('Prof. Chung', 'p-chung'), " and Prof. Lah's invited review paper on Structural Demons has been published in the special issue of the ", J('Israel Journal of Chemistry', 'ijc', '10.1002/ijch.70028'), '.'] },
  { y: '2026', m: '03', parts: [P('Muhammad (무하마드)', 'm-hassan'), "'s review paper on direct air capture has been published in the ", J('Chemical Engineering Journal', 'cej', '10.1016/j.cej.2026.175117'), '. Congratulations!'] },
  { y: '2026', m: '03', parts: [P('Haewon (김해원)', 'a-haewon'), ' and ', P('Taekgi (이택기)', 'm-lee'), "'s paper on machine learning and large language models to predict lithium ion conductivity in solid-state electrolytes has been published in the ", J('Journal of Chemical Physics', 'jcp', '10.1063/5.0307954'), '. Congratulations!'] },
  { y: '2026', m: '02', parts: [P('Prof. Chung', 'p-chung'), ' was quoted in the Research Briefing by ', J('Nature Computational Science', 'ncs'), '.'] },
  { y: '2026', m: '02', parts: [P('Youri Ran', 'a-youri'), ' from Universiteit van Amsterdam (Computational Chemistry Group; supervised by David Dubbeldam) joins the group as a visiting Ph.D. student. Welcome!'] },
  { y: '2026', m: '02', parts: [P('Sunghyun (윤성현)', 'm-yoon'), " successfully defended and received his Ph.D. in Chemical Engineering. He continues in the group as a Postdoctoral Researcher. Congratulations!"] },
  { y: '2026', m: '01', parts: [P('Haewon (김해원)', 'a-haewon'), " graduates with a Master's degree in Chemical Engineering and joins SK hynix as an Engineer. Congratulations!"] },
  { y: '2025', m: '12', parts: [P('Sunghyun (윤성현)', 'm-yoon'), "'s paper on MPD integrated process modeling and optimization was published in ", J('Industrial & Engineering Chemistry Research', 'iecr', '10.1021/acs.iecr.5c03794'), '.'] },
  { y: '2025', m: '12', parts: [P('Guobin (구오빈 자오)', 'a-guobin'), ' joined the MACE group (PI: Xiaoyan Li) in the Department of Chemistry at the National University of Singapore as a Postdoc.'] },
  { y: '2025', m: '11', parts: [P('Muhammad (하산 무하마드)', 'm-hassan'), ', ', P('Sunghyun (윤성현)', 'm-yoon'), ', and ', P('Yu (첸유)', 'm-chen'), "'s paper was published online in ", J('Computer Physics Communications', 'cpc', '10.1016/j.cpc.2025.109944'), '.'] },
  { y: '2025', m: '11', parts: [P('Changdon (신창돈)', 'm-shin'), ' and ', P('Sunghyun (윤성현)', 'm-yoon'), "'s paper was published online in ", J('Molecular Systems Design & Engineering', 'msde', '10.1039/D5ME00131E'), '.'] },
  { y: '2025', m: '10', parts: [P('Prof. Chung', 'p-chung'), ' quoted in the ChemistryWorld article on neural networks trained to classify crystal structure errors in MOF databases.'] },
  { y: '2025', m: '10', parts: [P('Yu (첸유)', 'm-chen'), ' and ', P('Guobin (구오빈 자오)', 'a-guobin'), "'s paper was published online in ", J('Langmuir', 'lang', '10.1021/acs.langmuir.5c04369'), '.'] },
  { y: '2025', m: '08', parts: [P('Sunghyun (윤성현)', 'm-yoon'), ', ', P('Guobin (구오빈 자오)', 'a-guobin'), ', and ', B('Yeji (이예지)'), "'s paper was published online in ", J('Separation and Purification Technology', 'spt', '10.1016/j.seppur.2025.134786'), '.'] },
  { y: '2025', m: '08', parts: [P('Guobin (구오빈 자오)', 'a-guobin'), ' and ', P('Pengyu (펑위 자오)', 'm-zhao'), "'s paper on MOFClassifier was published online in the ", J('Journal of the American Chemical Society', 'jacs', '10.1021/jacs.5c10126'), '.'] },
  { y: '2025', m: '05', parts: [P('Guobin (구오빈 자오)', 'a-guobin'), ', ', P('Sunghyun (윤성현)', 'm-yoon'), ', and ', P('Haewon (김해원)', 'a-haewon'), "'s paper on CoRE MOF DB was published online in ", J('Matter', 'matter', '10.1016/j.matt.2025.102140'), '.'] },
  { y: '2025', m: '02', parts: [P('Sunghyun (윤성현)', 'm-yoon'), "'s paper on techno-economic analysis of boil-off gas treatment using MOF was published in ", J('Chemical Engineering Journal', 'cej', '10.1016/j.cej.2025.160517'), '.'] },
  { y: '2024', m: '11', parts: [P('Haewon (김해원)', 'a-haewon'), ' won the Grand Prize at the first Medical AI competition! Congratulations!'] },
  { y: '2024', m: '10', parts: ['Undergraduate students ', P('Taekgi (이택기)', 'm-lee'), ' and ', B('Jaehoon (김재훈)'), ' won the Samsung AI Challenge! Congratulations!'] },
  { y: '2024', m: '10', parts: [P('Yu (첸유)', 'm-chen'), ' published a paper on force field parameters for Mg-catecholate and hydrogen, and high-throughput screening of COFs, in ', J('ACS Applied Materials & Interfaces', 'ami', '10.1021/acsami.4c11953'), '.'] },
  { y: '2024', m: '09', parts: [P('Sunghyun (윤성현)', 'm-yoon'), ' and ', P('Muhammad (하산 무하마드)', 'm-hassan'), "'s paper on pressure-vacuum swing adsorption modeling and optimization for a ternary system was published in ", J('Chemical Engineering Journal', 'cej', '10.1016/j.cej.2024.154116'), '.'] },
  { y: '2024', m: '09', parts: [P('Haewon (김해원)', 'a-haewon'), ' published a collaborative paper on modeling aqueous zinc metal batteries with SKKU in ', J('Advanced Functional Materials', 'afm', '10.1002/adfm.202412577'), '.'] },
  { y: '2024', m: '08', parts: [P('Muhammad (하산 무하마드)', 'm-hassan'), " successfully defended his Master's degree in Chemical Engineering. He continues in the group as a Ph.D. student. Congratulations!"] },
  { y: '2024', m: '06', parts: [P('Guobin (구오빈 자오)', 'a-guobin'), "'s paper on a machine learning model to predict partial atomic charges in porous materials was published in the ", J('Journal of Chemical Theory and Computation', 'jctc', '10.1021/acs.jctc.4c00434'), '.'] },
  { y: '2024', m: '04', parts: [P('Yu (첸유)', 'm-chen'), ' published a collaborative paper on modeling porous aromatic frameworks with Korea University in ', J('Advanced Materials', 'am', '10.1002/adma.202401739'), '.'] },
  { y: '2024', m: '04', parts: [P('Guobin (구오빈 자오)', 'a-guobin'), ' and ', P('Haewon (김해원)', 'a-haewon'), ' published a paper on machine learning models for low-GWP and molecular lifetime in the ', J('Journal of Physical Chemistry A', 'jpca', '10.1021/acs.jpca.3c07339'), '.'] },
  { y: '2024', m: '02', parts: [P('Prof. Chung', 'p-chung'), ' published a collaborative review paper on computational MOF discovery in ', J('Nature Energy', 'ne', '10.1038/s41560-023-01417-2'), '.'] }
];

// Fully-built news items, newest first: { year, date, month, parts }
const NEWS = NEWS_RAW.map(i => ({ year: i.y, date: MN[i.m] || i.m, month: MN[i.m] || i.m, parts: norm(i.parts) }));

const SC = (q) => 'https://scholar.google.com/scholar?q=%22' + encodeURIComponent(q) + '%22';
const REVIEW = { '72': 'Invited review', '70': 'Review', '48': 'Review', '37': 'Review', '21': 'Review', '17': 'Review' };
const kindOf = (no, title) => REVIEW[no] || (/\breview\b/i.test(title) ? 'Review' : 'Article');
const F = (no, title, authors, jk, journal, meta, code, doi) => ({
  no, title, authors, journal, jurl: JU[jk], meta,
  code: code || false, doi: doi || false,
  html: doi ? 'https://doi.org/' + doi : SC(title),
  cite: SC(title), pdf: false,
  kind: kindOf(no, title),
  year: (meta.match(/\((\d{4})\)/) || [])[1] || ''
});

// Full publication list, newest first.
const PUBS = [
  F('72', 'Hunting Structural Demons in Digital Reticular Chemistry: Lessons from Metal-Organic Frameworks', 'Chung, Y.G.*, Lah, M.S.', 'ijc', 'Israel Journal of Chemistry', ', 66, e70028 (2026)', null, '10.1002/ijch.70028'),
  F('71', 'Data-driven Prediction of Ionic Conductivity in Solid-State Electrolytes with Machine Learning and Large Language Models', 'Kim, H.#, Lee, T.#, Hong, S., Kim, K.H., Chung, Y.G.*', 'jcp', 'Journal of Chemical Physics', ', 164, 114502 (2026)', null, '10.1063/5.0307954'),
  F('70', 'Direct Air Capture with Solid-Sorbents: Adsorbent Design, Process Engineering, and CO2 Conversion', 'Hassan, M., Shin, C., Lee, T., Lee, S., Chowdhury, S., Kwon, H-.T., Kang, S.G.*, Ahn, S.*, Chung, Y.G.*', 'cej', 'Chemical Engineering Journal', ', 534, 175117 (2026)', null, '10.1016/j.cej.2026.175117'),
  F('69', 'Bridging the gap between materials and engineering: large-scale screening of MOFs for adsorption cooling from device-level', 'Wang, Y., Chung, Y.G., Wu, W., Li, W.*, Li, S.*', 'aem', 'Advanced Energy Materials', ', 16, e04672 (2026)', null, '10.1002/aenm.202504672'),
  F('68', 'AIM: A User-friendly GUI Workflow program for Isotherm Fitting, Mixture Prediction, Isosteric Heat of Adsorption Estimation, and Breakthrough Simulation', 'Hassan, M., Yoon, S., Chen, Y., Kim, P., Yun, H., Kwon, H.T., Bae, Y.S., Yoo, C.Y., Koh, D.Y., Hong, C.S., Lee, K.B., Chung, Y.G.*', 'cpc', 'Computer Physics Communications', ', 319, 109944 (2026)', 'https://github.com/Chung-Research-Group/AIM', '10.1016/j.cpc.2025.109944'),
  F('67', 'Multiscale, Techno-economic Evaluation of Isoreticular Series of CALF-20 for Biogas Upgrading using a Pressure/Vacuum Swing Adsorption (PVSA) Process', 'Shin, C., Yoon, S., Chung, Y.G.*', 'msde', 'Molecular Systems Design & Engineering', ', 11, 181–194 (2026)', null, '10.1039/D5ME00131E'),
  F('66', 'Integrating Macrostate Probability Distributions with Swing Adsorption Modeling for Binary/Ternary Gas Separation', 'Yoon, S.#, Tu, J.#, Lin, L.C.*, Chung, Y.G.*', 'iecr', 'Industrial & Engineering Chemistry Research', ', 64, 25017–25033 (2025)', null, '10.1021/acs.iecr.5c03794'),
  F('65', 'A Master Isotherm Model Approach to Quantify Defects in UiO-66 from Nitrogen Adsorption Isotherms', 'Chen, Y., Zhao, G., Lin, L.C., Chung, Y.G.*', 'lang', 'Langmuir', ', 41, 29851–29858 (2025)', null, '10.1021/acs.langmuir.5c04369'),
  F('64', 'Techno-economic analysis of Cu(I)-loaded porous carbons for CO separation using pressure/vacuum swing adsorption process', 'Yoon, S., Jung, J., Zhao, G., Lee, Y., Lee, K.B.*, Chung, Y.G.*', 'spt', 'Separation and Purification Technology', ', 378, 134786 (2025)', null, '10.1016/j.seppur.2025.134786'),
  F('63', 'MOFClassifier: A Machine Learning Approach for Validating Computation-Ready Metal-Organic Frameworks', 'Zhao, G., Zhao, P., Chung, Y.G.*', 'jacs', 'Journal of the American Chemical Society', ', 147, 33343–33349 (2025)', 'https://github.com/Chung-Research-Group/MOFClassifier', '10.1021/jacs.5c10126'),
  F('62', 'Accelerated Discovery of High-Performance MOFs for Water Adsorption Chillers through Molecular Simulation and Machine Learning', 'Liu, Z., Shen, D., Chung, Y.G., Li, W., Li, S.*', 'cej', 'Chemical Engineering Journal', ', 517, 164419 (2025)', null, '10.1016/j.cej.2025.164419'),
  F('61', 'Enhancing Interchain Interactions in Spirobifluorene-Based Microporous Polyimides for High-Performance Organic Solvent Nanofiltration', 'Jang, M-J., Chen, Y., Choi, J., Seo, H., Chung, Y.G., Koh, D.-Y.*', 'jms', 'Journal of Membrane Science', ', 733, 124298 (2025)', null, '10.1016/j.memsci.2025.124298'),
  F('60', 'CoRE MOF DB: a curated experimental metal-organic framework database with machine-learned properties for integrated material-process screening', 'Zhao, G., Brabson, L.M., Chheda, S., et al., Chung, Y.G.*', 'matter', 'Matter', ', 8, 102140 (2025)', 'https://github.com/Chung-Research-Group/CoRE-MOF-Tools', '10.1016/j.matt.2025.102140'),
  F('59', 'Modeling, screening, and techno-economic evaluation of MOFs for boil-off gas capture during intercontinental transportation of LNG', 'Yoon, S., Mun, H., Ga, S., Park, J., Lee, I.*, Chung, Y.G.*', 'cej', 'Chemical Engineering Journal', ', 507, 160517 (2025)', null, '10.1016/j.cej.2025.160517'),
  F('58', 'Hierarchically Structured Conductive Lanthanide Metal Organic Framework Nanorods for Ultrastable Flexible Magnesium Ion Capacitors', 'Park, H.R., Jang, G., Byun, J.S., et al., Park, H.S.*', 'afm', 'Advanced Functional Materials', ', 35, 2417288 (2025)', null, '10.1002/adfm.202417288'),
  F('57', 'Polyoxometalate initiated in-situ conformal coating of multifunctional hybrid artificial layers for high-performance zinc metal anodes', 'Byun, J.S., Kim, W.I., Baek, S.H., et al., Park, H.S.*', 'afm', 'Advanced Functional Materials', ', 35, 2412577 (2025)', null, '10.1002/adfm.202412577'),
  F('56', 'Computational Exploration of Adsorption-based Hydrogen Storage in Mg-alkoxide Functionalized COFs: Force-field and Machine Learning Models', 'Chen, Y., Zhao, G., Yoon, S., et al., Chung, Y.G.*', 'ami', 'ACS Applied Materials & Interfaces', ', 16, 61995–62009 (2024)', null, '10.1021/acsami.4c11953'),
  F('55', 'Multiscale computational modeling and process economic optimization of all-silica zeolites for adsorptive separation of ternary (H2S/CO2/CH4) gas mixture', 'Yoon, S.#, Hassan, M.#, Chung, Y.G.*', 'cej', 'Chemical Engineering Journal', ', 496, 154116 (2024)', null, '10.1016/j.cej.2024.154116'),
  F('54', 'PACMAN: A Robust Partial Atomic Charge Predicter for Nanoporous Materials based on Crystal Graph Convolution Networks', 'Zhao, G., Chung, Y.G.*', 'jctc', 'Journal of Chemical Theory and Computation', ', 20, 5352–5367 (2024)', 'https://github.com/Chung-Research-Group/PACMAN-charge', '10.1021/acs.jctc.4c00434'),
  F('53', 'Linker defect-assisted catalytic fixation of CO2 in a dual-linker metal-organic framework', 'Gu, Y.#, Yoon, S.#, Babu, R., Chung, Y.G., Park, D.W.*', 'rkmc', 'Reaction Kinetics, Mechanisms, and Catalysis', ', 137, 2197–2213 (2024)', null, '10.1007/s11144-024-02656-4'),
  F('52', 'Transfer learning-assisted computational screening of MOFs and COFs for the separation of Xe/Kr noble gas', 'Cai, Z., Li, W.*, Chung, Y.G., Li, S., Liang, T., Wu, T.', 'spt', 'Separation and Purification Technology', ', 348, 127752 (2024)', null, '10.1016/j.seppur.2024.127752'),
  F('51', 'High Hydrogen Storage in Trigonal Prismatic Monomer-based Highly Porous Aromatic Frameworks', 'Kim, D.W.#, Chen, Yu#, Kim, H., et al., Chung, Y.G.*, Hong, C.S.*', 'am', 'Advanced Materials', ', 36, 2401739 (2024)', null, '10.1002/adma.202401739'),
  F('50', 'Leveraging Machine Learning to Predict the Atmospheric Lifetime and the Global Warming Potential (GWP) of SF6 Replacement Gases', 'Zhao, G.#, Kim, H.#, Yang, C.W., Chung, Y.G.*', 'jpca', 'Journal of Physical Chemistry A', ', 128, 2399–2408 (2024)', null, '10.1021/acs.jpca.3c07339'),
  F('49', 'Anion storing, oxygen vacancy incorporated perovskite oxide composites for high-performance aqueous dual ion hybrid supercapacitors', 'Kang, T., Nakhanivej, P., Wang, K.J., Chen, Y., Chung, Y.G., Park, H.S.*', 'jec', 'Journal of Energy Chemistry', ', 94, 646–655 (2024)', null, '10.1016/j.jechem.2024.02.032'),
  F('48', 'Progress toward the computational discovery of new MOF adsorbents for energy applications', 'Moghadam, P.Z.#, Chung, Y.G.#, Snurr, R.Q.*', 'ne', 'Nature Energy', ', 9, 121–133 (2024)', null, '10.1038/s41560-023-01417-2'),
  F('47', 'Synthesis and characterization of bimetallic ZnCo-ZIF-71 with defect for an efficient catalytic CO2 conversion', 'Gu, Y.#, Yoon, S.#, Babu, R., Cho, S.J., Chung, Y.G.*, Park, D.W.*', 'kjche', 'Korean Journal of Chemical Engineering', ', 41, 749–761 (2024)', null, '10.1007/s11814-024-00048-x'),
  F('46', 'High-Throughput, Multiscale Computational Screening of Metal-Organic Frameworks for Xe/Kr Separation with Machine-Learned Parameters', 'Zhao, G., Chen, Y., Chung, Y.G.*', 'iecr', 'Industrial & Engineering Chemistry Research', ', 62, 37, 15176–15189 (2023)', null, '10.1021/acs.iecr.3c02211'),
  F('45', 'Construction of Chimeric Metal-Organic Frameworks with Symmetry-Mismatched Building Blocks', 'Han, S.#, Lee, S.#, Kim, D., Seong, J., Sharma, A., Lim, J., Zhao, G., Chen, Y., Baek, S.B., Chung, Y.G.*, Lah, M.S.*', 'cm', 'Chemistry of Materials', ', 35, 15, 5903–5913 (2023)', null, '10.1021/acs.chemmater.3c00694'),
  F('44', 'Polyoxometalate–Polymer Hybrid Artificial Layers for Ultrastable and Reversible Zn Metal Anodes', 'Baek, S.H., Byun, J.S., Kim, H.J., Lee, S.J., Park, J.M., Xiong, P., Chung, Y.G.*, Park, H.S.*', 'cej', 'Chemical Engineering Journal', ', 468, 143644 (2023)', null, '10.1016/j.cej.2023.143644'),
  F('43', 'SESAMI APP: An Accessible Interface for Surface Area Calculation of Materials from Adsorption Isotherms', 'Terrones, G.G., Chen, Y., Datar, A., Lin, L.C., Kulik, H.J., Chung, Y.G.*', 'joss', 'Journal of Open Source Software', ', 8, 86, 5429 (2023)', null, '10.21105/joss.05429'),
  F('42', 'A database of ultrastable MOFs reassembled from stable fragments with machine learning models', 'Nandy, A., Yue, S., Oh, C., Duan, C., Terrones, G.G., Chung, Y.G., Kulik, H.J.*', 'matter', 'Matter', ', 6, 5, 1585–1603 (2023)', null, '10.1016/j.matt.2023.03.009'),
  F('41', 'Effective delamination of a layered two-dimensional MCM-22 zeolite: Quantitative insights into the role of the delaminated structure on acid catalytic reactions', 'Lee, G.H., Jang, E., Lee, T., Jeong, Y., Kim, H., Lee, S., Chung, Y.G., Ha, K.S., Baik, H., Jang, H-G., Cho, S.J.*, Choi, J.K.*', 'cattoday', 'Catalysis Today', ', 411, 113856 (2023)', null, '10.1016/j.cattod.2022.07.024'),
  F('40', 'Room-Temperature Hydrogen Storage Performance of Metal-Organic Framework/Graphene Oxide Composites by Molecular Simulations', 'Liu, Y., Shen, D., Tu, Z., Xing, L., Chung, Y.G., Li, S.*', 'ijhe', 'International Journal of Hydrogen Energy', ', 47, 97, 41055–41068 (2022)', null, '10.1016/j.ijhydene.2022.09.199'),
  F('39', 'Highly Efficient Bromine Capture and Storage using N-containing Porous Organic Cages', 'Lee, S., Kevlishvili, I., Kulik, H.J., Kim, H-T., Chung, Y.G.*, Koh, D.Y.*', 'jmca', 'Journal of Materials Chemistry A', ', 10, 46, 24802–24812 (2022)', null, '10.1039/d2ta05420e'),
  F('38', 'Brunauer–Emmett–Teller Areas from Nitrogen and Argon Isotherms Are Similar', 'Datar, A.#, Yoon, S.#, Lin, L.C.*, Chung, Y.G.*', 'lang', 'Langmuir', ', 38, 38, 11631–11640 (2022)', null, '10.1021/acs.langmuir.2c01390'),
  F('37', 'Recent advances in software tools for adsorption science and engineering', 'Ga, S., Chung, Y.G.*', 'msde', 'Molecular Systems Design & Engineering', ', 6, 686–701 (2022)', null, '10.1039/D2ME00036A'),
  F('36', 'Defect-engineered MOF-801 for cycloaddition of CO2 with epoxides', 'Gu, Y., Bai, A., Yoon, S., Chung, Y.G.*, Park, D.W.*', 'jmca', 'Journal of Materials Chemistry A', ' (2022)', null, '10.1039/D2TA00503D'),
  F('35', 'Discovery of High-Performing Metal-Organic Frameworks for On-Board Methane Storage and Delivery via LNG–ANG Coupling: High-Throughput Screening, Machine Learning, and Experimental Validation', 'Kim, S.Y.#, Han, S.#, Lee, S., Kang, J.H., Yoon, S., Park, W., Shin, M.W., Kim, J., Chung, Y.G.*, Bae, Y.S.*', 'advsci', 'Advanced Science', ', 9, 21, 2201559 (2022)', null, '10.1002/advs.202201559'),
  F('34', 'Microplasma Band Structure Engineering in Graphene Quantum Dots for Sensitive and Wide-Range pH Sensing', 'Kurniawan, D., Bai, A.A., Setiawan, O., Ostrikov, K.K., Chung, Y.G.*, Chiang, W.H.*', 'ami', 'ACS Applied Materials & Interfaces', ', 14, 1, 1670–1683 (2022)', null, '10.1021/acsami.1c18440'),
  F('33', 'Integrated material and process evaluation of metal-organic frameworks database for energy-efficient SF6/N2 separation', 'Cha, J.#, Ga, S.#, Lee, S., Nam, S., Bae, Y.S.*, Chung, Y.G.*', 'cej', 'Chemical Engineering Journal', ', 426, 131787 (2021)', null, '10.1016/j.cej.2021.131787'),
  F('32', 'Limitation of model-based estimations of the hydrogen adsorption capacities in nanoporous materials: a molecular simulation study', 'Yoon, S., Chung, Y.G.*', 'bkcs', 'Bulletin of the Korean Chemical Society', ', 42, 11, 1539–1548 (2021)', null, '10.1002/bkcs.12380'),
  F('31', 'Shape-Selective Ultramicroporous Carbon Membranes for Sub-0.1 nm Organic Liquid Separation', 'Seo, H., Yoon, S., Oh, B., Chung, Y.G., Koh, D.Y.*', 'advsci', 'Advanced Science', ', 8, 17, 2004999 (2021)', null, '10.1002/advs.202004999'),
  F('30', 'High-Throughput Discovery of Ni(IN)2 for Ethane/Ethylene Separation', 'Kang, M.#, Yoon, S.#, Ga, S.#, Kang, D.W., Han, S., Choe, J.H., Kim, H., Kim, D.W., Chung, Y.G.*, Hong, C.S.*', 'advsci', 'Advanced Science', ', 8, 11, 2004940 (2021)', null, '10.1002/advs.202004940'),
  F('29', 'Unraveling the fluorescence quenching of colloidal graphene quantum dots for selective metal ion detection', 'Yeh, P.C.#, Yoon, S.#, Kurniawan, D., Chung, Y.G.*, Chiang, W.H.*', 'acsanm', 'ACS Applied Nano Materials', ', 4, 6, 5636–5642 (2021)', null, '10.1021/acsanm.1c00740'),
  F('28', 'Development and application of machine learning-based prediction model for distillation column', 'Kwon, H., Oh, K.C., Choi, Y., Chung, Y.G., Kim, J.*', 'ijis', 'International Journal of Intelligent Systems', ', 36, 5, 1970–1997 (2021)', null, '10.1002/int.22368'),
  F('27', 'Simultaneous Removal of NO and SO2 using Microbubble and Reducing Agent', 'Song, D.H., Kang, J.H., Park, H.S., Chung, Y.G., Song, H.*', 'ct', 'Clean Technology', ', 27, 4, 341–349 (2021)', null, '10.7464/ksct.2021.27.4.341'),
  F('26', 'Beyond the BET analysis: The surface area prediction of nanoporous materials using a machine learning method', 'Datar, A., Chung, Y.G.*, Lin, L.C.*', 'jpcl', 'Journal of Physical Chemistry Letters', ', 11, 14, 5412–5417 (2020)', null, '10.1021/acs.jpclett.0c01518'),
  F('25', 'Development of machine learning model for predicting distillation column temperature', 'Kwon, H., Oh, K.C., Chung, Y.G., Cho, H., Kim, J.*', 'ace', 'Applied Chemistry for Engineering', ', 31, 5, 520–525 (2020)', null, '10.14478/ace.2020.1057'),
  F('24', 'CO2 absorption characteristics of amino group functionalized imidazolium-based amino acid ionic liquids', 'Kang, S., Chung, Y.G., Kang, J.H., Song, H.*', 'jml', 'Journal of Molecular Liquids', ', 297, 111825 (2020)', null, '10.1016/j.molliq.2019.111825'),
  F('23', 'Synergistic effect of metal-organic framework-derived boron and nitrogen heteroatom-doped three-dimensional porous carbons for precious-metal-free catalytic reduction of nitroarenes', 'Nguyen, C.V.#, Lee, S.#, Chung, Y.G.*, Chiang, W.H.*, Wu, K.C.W.*', 'acb', 'Applied Catalysis B: Environmental', ', 257, 117888 (2019)', null, '10.1016/j.apcatb.2019.117888'),
  F('22', 'Advances, updates, and analytics for the computation-ready, experimental metal-organic framework database: CoRE MOF 2019', 'Chung, Y.G.#*, Haldoupis, E.#, Bucior, B.J.#, Haranczyk, M., Lee, S., Zhang, H., Vogiatzis, K.D., Milisavljevic, M., Ling, S., Camp, J.S., Slater, B., Siepmann, J.I.*, Sholl, D.S.*, Snurr, R.Q.*', 'jced', 'Journal of Chemical & Engineering Data', ', 64, 12, 5985–5998 (2019)', null, '10.1021/acs.jced.9b00835'),
  F('21', 'The role of molecular modelling and simulation in the discovery and deployment of metal-organic frameworks for gas storage and separation', 'Sturluson, A., Huynh, M.T., Kaija, A.R., Laird, C., Yoon, S., Hou, F., Feng, Z., Wilmer, C.E.*, Colón, Y.J.*, Chung, Y.G.*, Siderius, D.W.*, Simon, C.M.*', 'molsim', 'Molecular Simulation', ', 45, 14–15, 1082–1121 (2019)', null, '10.1080/08927022.2019.1648809'),
  F('20', 'The Origin of p-Xylene Selectivity in a DABCO Pillar-Layered Metal-Organic Framework: A Combined Experimental and Computational Investigation', 'Kim, S.I.#, Lee, S.#, Chung, Y.G.*, Bae, Y.S.*', 'ami', 'ACS Applied Materials & Interfaces', ', 11, 34, 31227–31236 (2019)', null, '10.1021/acsami.9b11343'),
  F('19', 'Surface area determination of porous materials using the Brunauer–Emmett–Teller (BET) method: limitations and improvements', 'Sinha, P.#, Datar, A.#, Jeong, C., Deng, X., Chung, Y.G.*, Lin, L.C.*', 'jpcc', 'Journal of Physical Chemistry C', ', 123, 33, 20195–20209 (2019)', null, '10.1021/acs.jpcc.9b02116'),
  F('18', 'Development of a General Evaluation Metric for Rapid Screening of Adsorbent Materials for Post-combustion CO2 Capture', 'Leperi, K.T.#, Chung, Y.G.#, You, F.*, Snurr, R.Q.*', 'acssce', 'ACS Sustainable Chemistry & Engineering', ', 7, 13, 11529–11539 (2019)', null, '10.1021/acssuschemeng.9b01418'),
  F('17', 'Elucidation of flexible metal-organic frameworks: Research progresses and recent developments', 'Lee, J.H., Jeoung, S., Chung, Y.G.*, Moon, H.R.*', 'ccr', 'Coordination Chemistry Reviews', ', 389, 161–188 (2019)', null, '10.1016/j.ccr.2019.03.008'),
  F('16', 'Two-dimensional Zn-stilbene-dicarboxylic acid (SDC) metal-organic frameworks for cyclic carbonate synthesis from CO2 and epoxides', 'Choi, G.G., Kurisingal, J.F., Chung, Y.G.*, Park, D.W.*', 'kjche', 'Korean Journal of Chemical Engineering', ', 35, 1373–1379 (2018)', null, '10.1007/s11814-018-0023-y'),
  F('15', 'Cycloaddition of CO2 with epoxides by using an amino-acid-based Cu(II)–tryptophan MOF catalyst', 'Jeong, G.S., Kathalikkattil, A.C., Babu, R., Chung, Y.G., Park, D.W.*', 'cjc', 'Chinese Journal of Catalysis', ', 39, 1, 63–70 (2018)', null, '10.1016/S1872-2067(17)62916-4'),
  F('14', 'High-Throughput Computational Screening of Multivariate Metal-Organic Frameworks (MTV-MOFs) for CO2 Capture', 'Li, S., Chung, Y.G., Simon, C.M., Snurr, R.Q.*', 'jpcl', 'Journal of Physical Chemistry Letters', ', 8, 24, 6135–6141 (2017)', null, '10.1021/acs.jpclett.7b02700'),
  F('13', 'Computational screening of nanoporous materials for hexane and heptane isomer separation', 'Chung, Y.G.#, Bai, P.#, Haranczyk, M., Leperi, K.T., Li, P., Zhang, H., Wang, T.C., Duerinck, T., You, F., Hupp, J.T., Farha, O.K., Siepmann, J.I., Snurr, R.Q.*', 'cm', 'Chemistry of Materials', ', 29, 15, 6315–6328 (2017)', null, '10.1021/acs.chemmater.7b01565'),
  F('12', 'The Role of Partial Atomic Charge Assignment Methods on the Computational Screening of Metal-Organic Frameworks for CO2 Capture under Humid Conditions', 'Li, W., Rao, Z., Chung, Y.G., Li, S.*', 'chemsel', 'ChemistrySelect', ', 2, 29, 9458–9465 (2017)', null, '10.1002/slct.201701934'),
  F('11', 'Large-scale refinement of metal-organic framework structures using density functional theory', 'Nazarian, D., Camp, J.S., Chung, Y.G., Snurr, R.Q., Sholl, D.S.*', 'cm', 'Chemistry of Materials', ', 29, 6, 2521–2528 (2017)', null, '10.1021/acs.chemmater.6b04226'),
  F('10', 'Catalytic performance of zeolitic imidazolate framework ZIF-95 for the solventless synthesis of cyclic carbonates from CO2 and epoxides', 'Bhin, K.M., Tharun, J., Roshan, K.R., Kim, D.W., Chung, Y.G., Park, D.W.*', 'jco2', 'Journal of CO2 Utilization', ', 17, 112–118 (2017)', null, '10.1016/j.jcou.2016.12.001'),
  F('09', 'In silico discovery of metal-organic frameworks for precombustion CO2 capture using a genetic algorithm', 'Chung, Y.G.#, Gómez-Gualdrón, D.A.#, Li, P., Leperi, K.T., Deria, P., Zhang, H., Vermeulen, N.A., Stoddart, J.F., You, F., Hupp, J.T., Farha, O.K., Snurr, R.Q.*', 'sciadv', 'Science Advances', ', 2, 10, e1600909 (2016)', null, '10.1126/sciadv.1600909'),
  F('08', 'High-Throughput Screening of Metal-Organic Frameworks for CO2 Capture in the Presence of Water', 'Li, S., Chung, Y.G., Snurr, R.Q.*', 'lang', 'Langmuir', ', 32, 40, 10368–10376 (2016)', null, '10.1021/acs.langmuir.6b02803'),
  F('07', 'Water stabilization of Zr6-based metal-organic frameworks via solvent-assisted ligand incorporation', 'Deria, P., Chung, Y.G., Snurr, R.Q., Hupp, J.T.*, Farha, O.K.*', 'chemsci', 'Chemical Science', ', 6, 9, 5172–5176 (2015)', null, '10.1039/C5SC01784J'),
  F('06', 'The materials genome in action: identifying the performance limits for methane storage', 'Simon, C.M., Kim, J., Gomez-Gualdron, D.A., Camp, J.S., Chung, Y.G., Martin, R.L., Mercado, R., Deem, M.W., Gunter, D., Haranczyk, M., Sholl, D.S., Snurr, R.Q.*, Smit, B.*', 'ees', 'Energy & Environmental Science', ', 8, 4, 1190–1199 (2015)', null, '10.1039/C4EE03515A'),
  F('05', 'Computation-ready, experimental metal-organic frameworks: A tool to enable high-throughput screening of nanoporous crystals', 'Chung, Y.G., Camp, J., Haranczyk, M., Sikora, B.J., Bury, W., Krungleviciute, V., Yildirim, T., Farha, O.K., Sholl, D.S.*, Snurr, R.Q.*', 'cm', 'Chemistry of Materials', ', 26, 21, 6185–6192 (2014)', null, '10.1021/cm502594j'),
  F('04', 'Atomic mobility in strained glassy polymers: The role of fold catastrophes on the potential energy surface', 'Chung, Y.G., Lacks, D.J.*', 'jpsb', 'Journal of Polymer Science Part B: Polymer Physics', ', 50, 24, 1733–1739 (2012)', null, '10.1002/polb.23166'),
  F('03', 'Atomic mobility in a polymer glass after shear and thermal cycles', 'Chung, Y.G., Lacks, D.J.*', 'jpcb', 'Journal of Physical Chemistry B', ', 116, 48, 14201–14205 (2012)', null, '10.1021/jp309772f'),
  F('02', 'How deformation enhances mobility in a polymer glass', 'Chung, Y.G., Lacks, D.J.*', 'macromol', 'Macromolecules', ', 45, 10, 4416–4421 (2012)', null, '10.1021/ma300431x'),
  F('01', 'Sheared polymer glass and the question of mechanical rejuvenation', 'Chung, Y.G., Lacks, D.J.*', 'jcp', 'The Journal of Chemical Physics', ', 136, 12 (2012)', null, '10.1063/1.3698473')
];

// Editorial topic assignments. These are intentionally explicit rather than
// inferred in the browser so classification remains reviewable and stable.
const PUB_TOPICS = {
  '72': ['Review'], '71': ['Machine Learning', 'LLM', 'Materials Data', 'Transport', 'Electrochemistry', 'electrolytes'], '70': ['Review'],
  '69': ['Adsorption', 'Transport', 'Device', 'reticular materials'], '68': ['Infrastructure', 'Adsorption', 'Statistical Mechanics'], '67': ['GCMC', 'Adsorption', 'Techno-economic analysis', 'Pressure-swing adsorption', 'reticular materials'],
  '66': ['GCMC', 'Adsorption', 'Statistical Mechanics'], '65': ['GCMC', 'Adsorption', 'reticular materials'], '64': ['Adsorption', 'Techno-economic analysis', 'Pressure-swing adsorption', 'carbons'], '63': ['Machine Learning', 'Materials Data', 'reticular materials'],
  '62': ['GCMC', 'Machine Learning', 'Adsorption', 'Device', 'reticular materials'], '61': ['Transport', 'polymers', 'membranes'], '60': ['GCMC', 'Infrastructure', 'Materials Data', 'Machine Learning', 'Adsorption', 'reticular materials'],
  '59': ['GCMC', 'Adsorption', 'Transport', 'Techno-economic analysis', 'reticular materials'], '58': ['DFT', 'Transport', 'Reaction', 'Electrochemistry', 'Device', 'reticular materials'], '57': ['Reaction', 'Transport', 'Electrochemistry', 'Device', 'oxides', 'polymers'],
  '56': ['GCMC', 'Machine Learning', 'Adsorption', 'reticular materials'], '55': ['GCMC', 'Adsorption', 'Techno-economic analysis', 'Pressure-swing adsorption', 'zeolites'], '54': ['GCMC', 'Machine Learning', 'Infrastructure', 'Materials Data', 'Adsorption', 'reticular materials'], '53': ['Reaction', 'reticular materials'],
  '52': ['GCMC', 'Machine Learning', 'Adsorption', 'reticular materials'], '51': ['GCMC', 'Adsorption', 'reticular materials'], '50': ['DFT', 'Machine Learning', 'Materials Data', 'molecules'], '49': ['Transport', 'Reaction', 'Electrochemistry', 'Device', 'oxides', 'carbons', 'perovskites'],
  '48': ['Review'], '47': ['Reaction', 'reticular materials'], '46': ['GCMC', 'Machine Learning', 'Materials Data', 'Adsorption', 'reticular materials'], '45': ['Reaction', 'reticular materials'],
  '44': ['Reaction', 'Transport', 'Electrochemistry', 'Device', 'oxides', 'polymers'], '43': ['Infrastructure', 'Adsorption'], '42': ['Machine Learning', 'Materials Data', 'Adsorption', 'reticular materials'],
  '41': ['Adsorption', 'Reaction', '2D', 'zeolites'], '40': ['GCMC', 'Adsorption', 'reticular materials', 'carbons'], '39': ['DFT', 'Adsorption', 'Reaction', 'molecules'], '38': ['GCMC', 'Adsorption', 'reticular materials'],
  '37': ['Review'], '36': ['Adsorption', 'Reaction', 'reticular materials'], '35': ['GCMC', 'MD', 'Machine Learning', 'Materials Data', 'Adsorption', 'reticular materials'], '34': ['DFT', '2D', 'carbons'],
  '33': ['GCMC', 'Materials Data', 'Adsorption', 'reticular materials'], '32': ['GCMC', 'Adsorption'],
  '31': ['Transport', 'carbons', 'membranes'], '30': ['DFT', 'GCMC', 'MD', 'Materials Data', 'Adsorption', 'reticular materials'], '29': ['DFT', '2D', 'carbons'], '28': ['Machine Learning'],
  '27': ['Reaction'], '26': ['Machine Learning', 'Materials Data', 'Adsorption', 'reticular materials'], '25': ['Machine Learning'], '24': ['Transport', 'Reaction', 'Statistical Mechanics', 'molecules'],
  '23': ['DFT', 'Adsorption', 'Reaction', 'carbons'], '22': ['Infrastructure', 'Materials Data', 'reticular materials'], '21': ['Review'],
  '20': ['DFT', 'Adsorption', 'reticular materials'], '19': ['GCMC', 'Adsorption', 'reticular materials', 'carbons'], '18': ['GCMC', 'Adsorption', 'reticular materials'], '17': ['Review'],
  '16': ['Adsorption', 'Reaction', '2D', 'reticular materials'], '15': ['Adsorption', 'Reaction', 'reticular materials'], '14': ['GCMC', 'Adsorption', 'reticular materials'],
  '13': ['GCMC', 'Adsorption', 'reticular materials', 'zeolites'], '12': ['GCMC', 'Adsorption', 'reticular materials'], '11': ['DFT', 'Materials Data', 'reticular materials'], '10': ['Reaction', 'reticular materials'],
  '09': ['GCMC', 'Materials Data', 'Adsorption', 'reticular materials'], '08': ['DFT', 'GCMC', 'Adsorption', 'reticular materials'], '07': ['Adsorption', 'Reaction', 'reticular materials'],
  '06': ['GCMC', 'Materials Data', 'Adsorption', 'reticular materials'], '05': ['GCMC', 'Materials Data', 'Infrastructure', 'Adsorption', 'reticular materials'], '04': ['MD', 'Transport', 'polymers'],
  '03': ['MD', 'Transport', 'polymers'], '02': ['MD', 'Transport', 'polymers'], '01': ['MD', 'Transport', 'polymers']
};
PUBS.forEach(p => { p.topics = PUB_TOPICS[p.no].slice(); });

window.MTAP_FEED = { JU: JU, NEWS: NEWS, PUBS: PUBS };
})(); }
