# Apartamenty Kaczorowskiego · budynek 1 – koncepcja podstrony

Koncepcja nowej odsłony podstrony inwestycji JAZ-BUD przy ul. Kaczorowskiego 1 w Białymstoku (budynek 1).
Strona nieoficjalna – aktualna oferta: [jaz-bud.pl](https://www.jaz-bud.pl/bialystok/ul-kaczorowskiego-budynek-1.html).

**Podgląd:** https://norbnauka.github.io/jazbud-kaczorowskiego/

## Co zawiera
- **Osiedle 360°** – 16 realistycznych ujęć z Blendera (Cycles) dookoła osiedla, na każdym kolorowe obrysy mieszkań (dostępne / rezerwacja / sprzedane), obracanie przeciąganiem lub strzałkami,
- widok osiedla na wizualizacji z lotu ptaka,
- interaktywny model 3D budynku 1 – każde z 422 mieszkań w kolorze statusu (dostępne / rezerwacja / sprzedane), obrót 360°, przekrój piętra,
- rzuty pięter z zaznaczonymi lokalami,
- wyszukiwarkę i tabelę mieszkań, kartę mieszkania z historią cen i kartą katalogową.

## Dane
Ceny i statusy to zrzut z jaz-bud.pl z 17.11.2026 (`dev/data/units.txt`). Położenie lokali odczytano z kart katalogowych (`dev/data/hulls.txt`).
Zdjęcia, rzuty i karty PDF są wczytywane bezpośrednio z jaz-bud.pl.

## Render 360° (Blender)
```
pip install bpy==4.5.0 shapely opencv-python-headless pillow   # Python 3.11
python dev/blender/scene.py out 0 15        # 16 ujęć: beauty_XX.jpg + mask_XX.png (ID mieszkań)
python dev/blender/post.py out r360         # WebP + obrysy mieszkań (r360.json)
```

## Budowanie
```
cd dev
npm i three@0.170.0
python3 build_data.py
python3 build.py --site   # -> dev/site/index.html + three.module.min.js
```
