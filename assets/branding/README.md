# Scene Forge artwork

The mark combines a tiled scene frame, an amber anvil, and a forging spark.
Mint corner highlights frame the composition; the anvil uses a cream working
surface, amber body, and one shaded support. It shares the compact silhouettes,
limited palette, and bitmap lettering of gbc-atlas and bambu-tui.

Every edge sits on the pixel grid. There is no smoothing, gradient, random
texture, or fractional scaling. The 16px favicon is drawn separately so the
anvil and spark remain legible at browser-tab size.

| File | Purpose |
| --- | --- |
| `logo.aseprite` | Layered 32×32 master: frame, anvil, spark |
| `logo-32.png` | Native transparent logo |
| `logo-64.png` | 2× web app mark |
| `logo-256.png`, `logo-512.png` | 8× and 16× transparent exports |
| `favicon-16.aseprite` | Simplified, optically adjusted 16×16 master |
| `hero.aseprite` | Layered 400×160 banner with custom 5×7 lettering |
| `hero-native.png` | Native banner export |
| `hero.png` | 1200×480 README hero, scaled 3× |

## Palette

| Color | Role |
| --- | --- |
| `#1B2528` | Outline and hero background |
| `#23373B` | Tile gutters and hero tile field |
| `#304D50` | Scene tiles |
| `#49716B` | Frame |
| `#A3CBA1` | Corner highlights and supporting lettering |
| `#F2E3B4` | Anvil surface, spark, and SCENE lettering |
| `#D4B767` | Anvil body and FORGE lettering; matches app accent |
| `#9C7244` | Anvil support shadow |

## Export

Use Aseprite's nearest-neighbor scaling at whole-number factors. From the repo
root (use the full application executable path if `aseprite` is not on PATH):

```sh
aseprite --batch assets/branding/logo.aseprite --save-as assets/branding/logo-32.png
aseprite --batch assets/branding/logo.aseprite --scale 2 --save-as assets/branding/logo-64.png
aseprite --batch assets/branding/logo.aseprite --scale 8 --save-as assets/branding/logo-256.png
aseprite --batch assets/branding/logo.aseprite --scale 16 --save-as assets/branding/logo-512.png
aseprite --batch assets/branding/hero.aseprite --save-as assets/branding/hero-native.png
aseprite --batch assets/branding/hero.aseprite --scale 3 --save-as assets/branding/hero.png
aseprite --batch assets/branding/favicon-16.aseprite --save-as src/gbc_scene_forge/static/branding/favicon-16.png
cp assets/branding/logo-32.png src/gbc_scene_forge/static/branding/favicon-32.png
cp assets/branding/logo-64.png src/gbc_scene_forge/static/branding/logo-64.png
```

The web app uses empty alt text for the mark because the adjacent heading names
the product. The hero's README alt text includes the product name and tagline.
Artwork is covered by the repository's MIT license.
