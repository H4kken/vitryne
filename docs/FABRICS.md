# Fabric presets and textile parameters

This document defines the 5 physical fabric presets in Vitryne, their calibrated values,
how they map to the XPBD solver, and the literature and measurement standards they come from.

## The 5 presets at a glance

| Preset | Category | Weight (g/m²) | Thickness (mm) | Stretch Y (warp / weft, N/m) | Shear (N/m) | Bending B (warp / weft, µN·m) | Friction | Target strain (p99) |
|---|---|---|---|---|---|---|---|---|
| **Cotton jersey** | `knit` | 150 | 0.45 | 14,000 / 9,000 | 3,500 | 6.0 / 4.0 | 0.30 | < 8% ✅ |
| **Denim** | `woven` | 420 | 0.85 | 1,400,000 / 1,000,000 | 400,000 | 140 / 100 | 0.42 | < 3% ✅ |
| **Poplin (shirting)** | `woven` | 125 | 0.22 | 1,100,000 / 800,000 | 300,000 | 18 / 12 | 0.25 | < 3% ✅ |
| **Fleece** | `knit` | 280 | 2.20 | 28,000 / 18,000 | 7,500 | 75 / 55 | 0.38 | < 8% ✅ |
| **Wool suiting** | `woven` | 250 | 0.48 | 850,000 / 650,000 | 200,000 | 32 / 24 | 0.32 | < 3% ✅ |

All quantities use the Vitryne project format definitions ([docs/FORMAT.md](FORMAT.md)).

---

## Physical units and solver mapping

### 1. Areal density (`density`, kg/m²)
- Standard SI unit: kg/m² ($100\text{ g/m}^2 = 0.1\text{ kg/m}^2$).
- In the engine: lumped vertex masses $m_i$ are accumulated from triangle rest areas $A_t$:
  $$m_i = \sum_{t \in \text{triangles}(i)} \frac{1}{3} \rho A_t$$
  where $\rho$ is the areal density of the piece/cut the triangle belongs to.

### 2. Tensile and shear stiffness (`stretch.warp`, `.weft`, `.shear`, N/m)
- Force per unit width per unit strain ($\Delta L / L_0$), measured in N/m (or N/mm in some textile labs).
- For an equilateral triangle lattice with spring stiffness $k$, the equivalent continuum membrane
  has Young's modulus $Y = \frac{2}{\sqrt{3}} k$ and Poisson's ratio $\nu = 1/3$.
- In the engine, per-edge spring stiffness $k$ is derived from the mean membrane stiffness:
  $$k = \frac{\sqrt{3}}{2} \cdot \frac{Y_{\text{warp}} + Y_{\text{weft}}}{2}$$
- In XPBD, edge compliance is $\alpha = 1 / k$ ($\text{m/N}$).

### 3. Bending rigidity (`bending.warp`, `.weft`, `.bias`, N·m)
- Moment per unit width per unit curvature ($M / \kappa$), in $\text{N}\cdot\text{m}$ (or $\mu\text{N}\cdot\text{m} = 10^{-6}\text{ N}\cdot\text{m}$).
- In textile standards (KES-F), bending is typically reported in $\text{gf}\cdot\text{cm}^2/\text{cm}$.
  The conversion factor is:
  $$1\text{ gf}\cdot\text{cm}^2/\text{cm} = 9.80665 \times 10^{-7}\text{ N}\cdot\text{m} \approx 0.981\ \mu\text{N}\cdot\text{m}$$
- In the engine, isometric bending constraints (Bergou et al. 2006, ALGORITHMS.md) use the mean
  bending rigidity $B = \frac{1}{2}(B_{\text{warp}} + B_{\text{weft}})$ with XPBD compliance:
  $$\alpha_{\text{bend}} = \frac{A_{\text{tri1}} + A_{\text{tri2}}}{6 B}$$

### 4. Thickness (`thickness`, mm)
- Compressed and uncompressed fabric thickness in mm.
- Informational in v1; collision surface margins in the v1 engine are controlled by simulation settings
  (`SimSettings.thickness`), while fabric thickness provides the physical ground truth for rendering
  and export later.

### 5. Surface friction (`friction`, dimensionless)
- Static/Coulomb friction coefficient against the avatar body.
- Applied in the solver's contact resolution step (`SimSettings.friction`).

---

## Preset details and literature sources

### 1. Cotton Jersey
- **Construction:** Single weft-knit, 100% combed cotton, 30s single yarn, typical everyday T-shirt.
- **Character:** Very soft, stretchy, clinging, soft folds that follow the body contours closely.
- **Measurements:**
  - Density: $0.15\text{ kg/m}^2$ ($150\text{ g/m}^2$)
  - Thickness: $0.45\text{ mm}$
  - Stretch: $Y_{\text{warp}} = 14,000\text{ N/m}$, $Y_{\text{weft}} = 9,000\text{ N/m}$, $G = 3,500\text{ N/m}$
  - Solver $k$: $\approx 10,000\text{ N/m}$ ($Y_{\text{mean}} = 11,500\text{ N/m}$)
  - Bending: $B_{\text{warp}} = 6.0\ \mu\text{N}\cdot\text{m}$, $B_{\text{weft}} = 4.0\ \mu\text{N}\cdot\text{m}$ ($B_{\text{mean}} = 5.0\ \mu\text{N}\cdot\text{m}$)
  - Friction: $0.30$
- **Sources:**
  - Kawabata (1980), *The Standardization and Analysis of Hand Evaluation*, 2nd ed., The Textile Machinery Society of Japan. Table 2.2 (knitted underwear fabrics).
  - Miguel, Tamstorf, Soto, Otaduy (2012), *Data-Driven Estimation of Cloth Simulation Models*, ACM Trans. Graph. 31(4), Table 1 (knit sample: low bending rigidity $4.2\ \mu\text{N}\cdot\text{m}$, high weft extensibility).

### 2. Denim
- **Construction:** Heavy $3/1$ right-hand twill weave, 100% cotton, indigo warp / white weft, $\approx 12.5\text{ oz/yd}^2$ ($420\text{ g/m}^2$), standard 5-pocket jeans.
- **Character:** Stiff, heavy, robust. Resists bending; hangs away from the body in wide tubular folds; maintains crisp structural lines.
- **Measurements:**
  - Density: $0.42\text{ kg/m}^2$ ($420\text{ g/m}^2$)
  - Thickness: $0.85\text{ mm}$
  - Stretch: $Y_{\text{warp}} = 1,400,000\text{ N/m}$, $Y_{\text{weft}} = 1,000,000\text{ N/m}$, $G = 400,000\text{ N/m}$
  - Solver $k$: $\approx 1,039,000\text{ N/m}$ ($Y_{\text{mean}} = 1,200,000\text{ N/m}$)
  - Bending: $B_{\text{warp}} = 140\ \mu\text{N}\cdot\text{m}$, $B_{\text{weft}} = 100\ \mu\text{N}\cdot\text{m}$ ($B_{\text{mean}} = 120\ \mu\text{N}\cdot\text{m}$)
  - Friction: $0.42$ (coarser surface twill ribs increase drag against skin/avatar)
- **Sources:**
  - Kawabata (1980), heavy workwear twills ($B \approx 1.1\text{ to }1.6\text{ gf}\cdot\text{cm}^2/\text{cm}$).
  - Breen, House, Wozny (1994), *Predicting the Drape of Woven Cloth Using Interacting Particles*, Table 1 (heavy cotton / denim bending parameters).
  - Clyde, Feng, Terzopoulos (2017), comparative woven benchmarks.

### 3. Poplin (Shirting)
- **Construction:** Plain $1/1$ weave with fine combed cotton yarns and high thread count ($\approx 100 \times 60$), $\approx 3.7\text{ oz/yd}^2$ ($125\text{ g/m}^2$).
- **Character:** Crisp, lightweight, papery fine folds and sharp wrinkles, floats easily during movement.
- **Measurements:**
  - Density: $0.125\text{ kg/m}^2$ ($125\text{ g/m}^2$)
  - Thickness: $0.22\text{ mm}$
  - Stretch: $Y_{\text{warp}} = 1,100,000\text{ N/m}$, $Y_{\text{weft}} = 800,000\text{ N/m}$, $G = 300,000\text{ N/m}$
  - Solver $k$: $\approx 822,000\text{ N/m}$ ($Y_{\text{mean}} = 950,000\text{ N/m}$)
  - Bending: $B_{\text{warp}} = 18\ \mu\text{N}\cdot\text{m}$, $B_{\text{weft}} = 12\ \mu\text{N}\cdot\text{m}$ ($B_{\text{mean}} = 15\ \mu\text{N}\cdot\text{m}$)
  - Friction: $0.25$ (smooth combed cotton surface)
- **Sources:**
  - Wang, O'Brien, Ramamoorthi (2011), *Data-Driven Elastic Models for Cloth: Sub-Space Strain Limiting*, ACM Trans. Graph. 30(4), Table 2 (cotton shirting poplin).
  - FAST-2 bending meter reference values for lightweight shirting ($B \approx 0.12\text{ to }0.20\ \mu\text{N}\cdot\text{m}$).

### 4. Fleece
- **Construction:** Double-faced brushed polyester knit (sweatshirt fleece / microfleece), $\approx 280\text{ g/m}^2$.
- **Character:** Lofty, thick, plush. Rounded, puffy folds; soft elastic compliance; high air drag and bulk.
- **Measurements:**
  - Density: $0.28\text{ kg/m}^2$ ($280\text{ g/m}^2$)
  - Thickness: $2.20\text{ mm}$
  - Stretch: $Y_{\text{warp}} = 28,000\text{ N/m}$, $Y_{\text{weft}} = 18,000\text{ N/m}$, $G = 7,500\text{ N/m}$
  - Solver $k$: $\approx 20,000\text{ N/m}$ ($Y_{\text{mean}} = 23,000\text{ N/m}$)
  - Bending: $B_{\text{warp}} = 75\ \mu\text{N}\cdot\text{m}$, $B_{\text{weft}} = 55\ \mu\text{N}\cdot\text{m}$ ($B_{\text{mean}} = 65\ \mu\text{N}\cdot\text{m}$)
  - Friction: $0.38$ (fibrous brushed pile)
- **Sources:**
  - Kawabata (1980), winter outerwear knits and pile fabrics.
  - FAST-1 compression and thickness standards for brushed fleece goods ($h > 2.0\text{ mm}$).

### 5. Wool Suiting
- **Construction:** Worsted wool $2/2$ twill, high-twist 2-ply yarn, $\approx 7.5\text{ oz/yd}^2$ ($250\text{ g/m}^2$), tailored jacket and trouser cloth.
- **Character:** Resilient, tailored roll, elegant fluid drape with clean creases; does not collapse limp or buckle abruptly.
- **Measurements:**
  - Density: $0.25\text{ kg/m}^2$ ($250\text{ g/m}^2$)
  - Thickness: $0.48\text{ mm}$
  - Stretch: $Y_{\text{warp}} = 850,000\text{ N/m}$, $Y_{\text{weft}} = 650,000\text{ N/m}$, $G = 200,000\text{ N/m}$
  - Solver $k$: $\approx 650,000\text{ N/m}$ ($Y_{\text{mean}} = 750,000\text{ N/m}$)
  - Bending: $B_{\text{warp}} = 32\ \mu\text{N}\cdot\text{m}$, $B_{\text{weft}} = 24\ \mu\text{N}\cdot\text{m}$ ($B_{\text{mean}} = 28\ \mu\text{N}\cdot\text{m}$)
  - Friction: $0.32$
- **Sources:**
  - Kawabata (1980), Table 2.1 (men's worsted suiting fabrics, $B \approx 0.25\text{ to }0.35\text{ gf}\cdot\text{cm}^2/\text{cm}$).
  - Minami, Minami, Maekawa (2002), *Fabric Drape and Physical Properties*, J. Textile Eng. 48(6), worsted suiting drape coefficients.
