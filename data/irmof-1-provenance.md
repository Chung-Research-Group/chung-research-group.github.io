# MOF-5 (IRMOF-1) homepage structure

Coordinates are from the [official RASPA2 CIF](https://github.com/iRASPA/RASPA2/blob/6498ab1eec9c8e0f063dcd0d71dd7add372c529b/structures/mofs/cif/IRMOF-1.cif), pinned to commit `6498ab1eec9c8e0f063dcd0d71dd7add372c529b`. The original CIF and [MIT copyright notice](irmof-1-LICENSE.txt) are included unchanged.

CIF citation: Eddaoudi et al., Science 295, 469–472 (2002), DOI: [10.1126/science.1067208](https://doi.org/10.1126/science.1067208).

The cubic conventional cell has a = b = c = 25.832 Å and angles 90°. Its 7 asymmetric sites and 192 explicit Fm-3m operations expand to 424 unique atoms: Zn32 O104 C192 H96, equivalent to 8 × Zn4O(BDC)3. No coordinates are invented or relaxed.

`python scripts/generate-mof-structure.py` validates the source hash, applies the explicit symmetry operations using exact rational arithmetic, and checks formula and periodic coordination. Bonds are distance-inferred for C–C, C–O, C–H and Zn–O, without bond orders. The source's C–H distance is 0.927 Å; it is not adjusted.

For display, H atoms are omitted and periodic bonds receive the correct image endpoints. Coordinates are centered Cartesian positions in Å. The finite view is a conventional cell with boundary image atoms, not a separate molecule. Zinc is blue, oxygen red and carbon gray. `node scripts/generate-mof-poster.mjs` produces the SVG from the same coordinates and projection used by the live renderer.

This is an illustrative, known MOF structure; it is not attributed as a structure discovered by this group.
