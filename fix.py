import re

path = '/Users/luisvaz/Documents/wonweather/index.html'
with open(path, 'r') as f:
    content = f.read()

# Fix 1: body scroll container
content = content.replace(
    'html, body {\n  width: 100%; height: 100%;\n  overflow: hidden;\n  background: var(--white);\n}\n\n#app {\n  width: 100vw;\n  height: 100vh;\n  overflow-y: scroll;\n  overflow-x: hidden;\n  -webkit-overflow-scrolling: touch;\n}',
    'html, body {\n  width: 100%; height: 100%;\n  overflow-x: hidden;\n  background: var(--white);\n}\n\n#app {\n  width: 100%;\n}'
)

# Fix 2: section heights
content = content.replace(
    '#s-intro { height: 200vh; position: relative; }',
    '#s-intro { height: 200px; position: relative; }'
)
content = content.replace(
    '#s-hours { height: calc(100vh * 9); position: relative; }',
    '#s-hours { height: 900px; position: relative; }'
)

# Fix 3: scroll listener
content = content.replace(
    'app.addEventListener(\'scroll\', onScroll, { passive: true });',
    'window.addEventListener(\'scroll\', onScroll, { passive: true });'
)

# Fix 4: scrollTop to scrollY
content = content.replace(
    'const sy = app.scrollTop;',
    'const sy = window.scrollY;'
)

# Fix 5: remove app scroll container reference, add setSectionHeights
content = content.replace(
    'const app = document.getElementById(\'app\');\n',
    ''
)

# Fix 6: replace init block
content = content.replace(
    'app.addEventListener(\'scroll\', onScroll, { passive: true });\n\n// Init after fonts/images settle\nupdateHour(0);\nsetTimeout(() => { captureStart(); applyZoom(0); }, 100);\nwindow.addEventListener(\'resize\', () => { captureStart(); onScroll(); });',
    '''window.addEventListener('scroll', onScroll, { passive: true });

function setSectionHeights() {
  const vh = window.innerHeight;
  document.getElementById('s-intro').style.height  = (vh * 2) + 'px';
  document.getElementById('s-hours').style.height  = (vh * 9) + 'px';
  document.getElementById('p-hours').style.height  = vh + 'px';
  document.getElementById('p-intro').style.height  = vh + 'px';
}
setSectionHeights();
window.addEventListener('resize', () => { setSectionHeights(); captureStart(); onScroll(); });

// Init
updateHour(0);
setTimeout(() => { captureStart(); applyZoom(0); }, 120);'''
)

# Fix 7: chars visible by default
content = content.replace(
    '.ch { display: inline; opacity: 0; position: relative; top: 10px; transition: opacity 0.06s, top 0.1s; }\n.ch.on { opacity: 1; top: 0; }',
    '.ch { display: inline; opacity: 1; position: relative; top: 0; transition: opacity 0.06s, top 0.1s; }\n.ch.anim { opacity: 0; top: 10px; }\n.ch.anim.on { opacity: 1; top: 0; }'
)

with open(path, 'w') as f:
    f.write(content)

print("Done! Checking fixes...")
checks = ['overflow-x: hidden', 'window.scrollY', 'setSectionHeights', 'width: 100%;']
for c in checks:
    print(f"  {'✓' if c in content else '✗ MISSING'}: {c}")
