"""Assemble the single-file page.  python3 build.py [--test]"""
import os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
rd = lambda p: open(os.path.join(HERE, p), encoding='utf-8').read()
test = '--test' in sys.argv
site = '--site' in sys.argv
IMG = 'http://localhost:8765' if test else 'https://www.jaz-bud.pl'

three = rd('node_modules/three/build/three.module.min.js')
assert '</script' not in three
body = rd('src/body.html').replace('{{IMG}}', IMG)

html = f'''<!DOCTYPE html>
<html lang="pl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Apartamenty Kaczorowskiego · Budynek 1 · Jaz-Bud Białystok</title>
<meta name="description" content="Mieszkania 1–4 pokojowe przy ul. Kaczorowskiego 1 w centrum Białegostoku. Interaktywna wizualizacja 3D, rzuty pięter, ceny i dostępność lokali.">
<meta name="theme-color" content="#ffffff">
<meta name="robots" content="noindex">
<link rel="icon" href="{IMG}/images/2023/logo-jazbud-lift-2.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;1,9..144,500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>
{rd('src/styles.css')}
</style>
</head>
<body>
{body}
<script>window.IMG_BASE={IMG!r};</script>
<script>
{rd('src/data.js')}
</script>
<script>
{rd('src/app.js')}
</script>
{'<script>window.THREE_URL="./three.module.min.js";</script>' if site else '<script type="text/plain" id="three-src">' + chr(10) + three + chr(10) + '</script>'}
<script type="module">
{rd('src/three3d.js')}
</script>
</body>
</html>
'''
out = os.path.join(HERE, 'test' if test else 'site' if site else 'dist')
os.makedirs(out, exist_ok=True)
name = 'index.html' if (test or site) else 'jazbud-kaczorowskiego-budynek-1.html'
if site:
    import shutil
    shutil.copy(os.path.join(HERE, 'node_modules/three/build/three.module.min.js'), out)
    open(os.path.join(out, '.nojekyll'), 'w').close()
open(os.path.join(out, name), 'w', encoding='utf-8').write(html)
print(os.path.join(out, name), len(html))
