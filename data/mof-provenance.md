# Homepage MOF structures: sources, transformations, and licenses

The rotating homepage viewer uses four attributed structures. These are illustrative known frameworks, not structures claimed to have been discovered by this group. Coordinates and crystallographic cells are derived from retained source files, not decorative geometry. Distances and cell lengths use angstroms (Å).

| Display | Retained source | Heavy atoms per cell | Heavy-atom composition | License |
| --- | --- | ---: | --- | --- |
| Cu-BTC / HKUST-1 | [RASPA2 CIF](mof-source/cu-btc.cif) | 528 | C288 Cu48 O192 | [RASPA MIT notice](mof-licenses/RASPA2-MIT.txt) |
| CALF-20, alpha publication model | [Derived CIF](mof-source/calf-20.cif), [original LAMMPS data](mof-source/calf-20-original.lmp) | 36 | C12 N12 O8 Zn4 | [GPLv3](mof-licenses/GPL-3.0.txt) |
| MOF-74 (Mg) / Mg-DOBDC | [RASPA2 CIF](mof-source/mg-mof-74.cif) | 144 | C72 Mg18 O54 | [RASPA MIT notice](mof-licenses/RASPA2-MIT.txt) |
| NU-1000 | [Syntax-repaired CIF](mof-source/nu-1000.cif), [original CIF](mof-source/nu-1000-original.cif) | 378 | C264 O96 Zr18 | [CC BY-NC 4.0](mof-licenses/CC-BY-NC-4.0.txt) |

The [machine-readable source registry](mof-sources.json) contains repository-relative paths, source URLs, exact SHA-256 hashes, revisions, cell parameters, licensing, and expected geometry counts. Source and license metadata were checked on 2026-10-09. Individual source licenses are retained; there is no catalog-wide MIT license.

## Cu-BTC and Mg-MOF-74

Both files are copied unchanged from the official RASPA2 repository at revision `6498ab1eec9c8e0f063dcd0d71dd7add372c529b`. The [Cu-BTC source](https://github.com/iRASPA/RASPA2/blob/6498ab1eec9c8e0f063dcd0d71dd7add372c529b/structures/mofs/cif/Cu-BTC.cif) cites Chui et al., Science (1999). The [Mg-MOF-74 source](https://github.com/iRASPA/RASPA2/blob/6498ab1eec9c8e0f063dcd0d71dd7add372c529b/structures/mofs/cif/MgMOF-74.cif) credits Ozgur Yazaydin. The original RASPA copyright and MIT permission notice are included unchanged in the [license directory](mof-licenses/README.md).

All supplied Fm-3m or R-3 symmetry operations are expanded, and symmetry-equivalent special positions are deduplicated. Mg-MOF-74 uses the original hexagonal cell with gamma = 120 degrees.

## CALF-20

Credit: Soham Mandal and Prabal K. Maiti, [Prediction of thermal conductivity in CALF-20 with first-principles accuracy via machine learning interatomic potentials](https://doi.org/10.1038/s43246-025-00745-y), Communications Materials 6, 22 (2025). The [publication data repository](https://github.com/shm-phy/GK_CALF-20/tree/e2199601366d1fd7dd96958f8445cc35c118adbd) explicitly declares GPLv3; the article's separate CC BY license is not used to relicense the repository data.

The original `MLP-MD/data_alpha_CALF-20.lmp` file is a restricted-triclinic 3 × 3 × 3 supercell containing 1,188 atoms. Its exact periodic copies are folded into the original 44-atom cell: Zn4 N12 O8 C12 H8. Each recovered atom has exactly 27 source copies; maximum Cartesian folding discrepancy is 7.22 × 10^-15 Å. No relaxation is performed. The derived CIF uses explicit P1 sites and retains the original monoclinic beta = 118.6754989624 degrees. This is the publication's simulation model, not an assertion that the coordinates are the original experimental CCDC deposition.

The raw data, derived CIF, complete GPLv3 text, and corresponding derivation scripts are distributed with this repository. The CALF-derived portions retain GPLv3 terms. [Source preparation](https://github.com/Chung-Research-Group/chung-research-group.github.io/blob/main/scripts/prepare-mof-sources.py) and [catalog generation](https://github.com/Chung-Research-Group/chung-research-group.github.io/blob/main/scripts/generate-mof-catalog.py) are available under GPLv3. These notices do not relicense independent site files or independently licensed source data.

## NU-1000

Credit: Pravas Deria, Joseph E. Mondloch, Emmanuel Tylianakis, Pritha Ghosh, Wojciech Bury, Randall Q. Snurr, Joseph T. Hupp, and Omar K. Farha. Source: [Perfluoroalkane Functionalization of NU-1000 via Solvent-Assisted Ligand Incorporation: Synthesis and CO2 Adsorption Studies](https://doi.org/10.1021/ja408959g), JACS (2013), supporting dataset [10.1021/ja408959g.s002](https://doi.org/10.1021/ja408959g.s002).

The [ACS Figshare record](https://acs.figshare.com/articles/dataset/2354203) identifies the exact `ja408959g_si_002.cif` file and licenses it under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/). Its unchanged original bytes are retained. The only CIF syntax repair is removing the final empty `loop_` directive; cell, coordinates, and P6/mmm symmetry operations are preserved. The derived visualization retains attribution, the noncommercial license, and this description of changes.

## Display derivation

The generator expands crystallographic symmetry and removes hydrogen atoms for display. It places real cell-face atom images on the corresponding faces, edges, or corners. Cartesian coordinates are centered at half the sum of the three lattice vectors. Bond connectivity is distance-inferred, without formal bond orders: metal–O/N cutoffs are 2.50 Å (Cu/Zn/Mg) or 2.65 Å (Zr); organic cutoffs are 1.2 times the sum of the tabulated C/N/O covalent radii in the script. Metal–metal and O–O lines are omitted. This illustrative connectivity is not a force field or a chemical bond-order assignment.

Periodic image ranges use reciprocal-plane heights. Colored bond halves are translated and clipped in fractional coordinates to the actual oblique unit cell, then mapped back to Cartesian positions. Boundary intersections do not introduce artificial atoms. The renderer shows the true eight cell corners and twelve edges; nonorthogonal cells are not replaced with Cartesian bounding boxes.

## Reproduction

From the repository root, with Python and the stated dependencies:

```sh
python -m pip install numpy==2.4.4 gemmi==0.7.5
python scripts/prepare-mof-sources.py --check
python scripts/generate-mof-catalog.py --check
```

Omit `--check` to recreate the canonical CIFs or catalog. These commands operate entirely on retained local data, without network calls or simulations. Generated canonical CIFs use explicit CRLF line endings to reproduce the retained approved bytes on every platform; the catalog uses UTF-8 with an LF final newline.

Source hashes, heavy-atom composition, bond/segment counts, positive cell volume, cell lengths/angles, and periodic clipping are checked during generation. The exported six-decimal Cartesian coordinates introduce at most approximately 5.7 × 10^-8 fractional-coordinate boundary error for this catalog. Expected heavy-atom cell counts are 528, 36, 144, and 378; inferred bond counts are 672, 50, 216, and 498, respectively.

## Interactive front pore view

The initial camera looks along [100] for CALF-20 and [001] for Cu-BTC, Mg-MOF-74, and NU-1000, without an oblique tilt. The camera basis is orthonormal; manual quaternion rotations preserve all Cartesian distances and cell angles. The [CALF-20 primary study](https://www.nature.com/articles/s41467-024-48136-0) also presents pore views along x. These directions are viewing choices, not measurements of pore diameters.

The viewer periodically translates the retained primitive-cell atoms and clipped bonds to show Cu-BTC 2×2×1, CALF-20 1×3×3, Mg-MOF-74 2×2×1, and NU-1000 1×1×1 cells. Coincident boundary atoms/segments are deduplicated. Captions state the repetitions, every primitive-cell edge is retained, and a primary cell is highlighted. No source CIF or catalog coordinates are changed. Repetition enlarges the visible framework region while all four structures retain the same angstrom-to-pixel scale and element radii at a given viewport and zoom level. CALF is repeated perpendicular to its a-axis view so the larger visible region represents neighboring pores rather than extra overlapping depth.
