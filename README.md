# Apartamenty Kaczorowskiego · budynek 1 – koncepcja podstrony

Koncepcja nowej odsłony podstrony inwestycji JAZ-BUD przy ul. Kaczorowskiego 1 w Białymstoku (budynek 1).
Strona nieoficjalna – aktualna oferta: [jaz-bud.pl](https://www.jaz-bud.pl/bialystok/ul-kaczorowskiego-budynek-1.html).

**Podgląd:** https://norbnauka.github.io/jazbud-kaczorowskiego/

## Co zawiera
- widok osiedla na wizualizacji z lotu ptaka,
- interaktywny model 3D budynku 1 – każde z 422 mieszkań w kolorze statusu (dostępne / rezerwacja / sprzedane), obrót 360°, przekrój piętra,
- rzuty pięter z zaznaczonymi lokalami,
- wyszukiwarkę i tabelę mieszkań, kartę mieszkania z historią cen i kartą katalogową.

## Dane
Ceny i statusy to zrzut z jaz-bud.pl z 17.11.2026 (`dev/data/units.txt`). Położenie lokali odczytano z kart katalogowych (`dev/data/hulls.txt`).
Zdjęcia, rzuty i karty PDF są wczytywane bezpośrednio z jaz-bud.pl.

## Budowanie
```
cd dev
npm i three@0.170.0
python3 build_data.py
python3 build.py --site   # -> dev/site/index.html + three.module.min.js
```
