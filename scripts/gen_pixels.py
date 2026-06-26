#!/usr/bin/env python3
"""Procedurally generate an 8-bit / pixel-art SVG landscape for the Boulot hero.
Real pixel grid: banded sky, ordered dithering at band edges, blocky sprites,
run-length-encoded rows so the file stays small. Crisp edges (no anti-alias)."""
import math, os

CELL = 15
W, H = 96, 52          # grid in cells -> 1440 x 780 px

def h(x, y):           # cheap deterministic hash -> [0,1)
    n = (x * 374761393 + y * 668265263) ^ 0x9E3779B9
    n = (n ^ (n >> 13)) * 1274126177
    return ((n ^ (n >> 16)) & 0xFFFF) / 65535.0

PAL = {
    's0':'#5fb0df','s1':'#86c9ec','s2':'#b3e0f3','s3':'#d9eef4',
    'sun':'#ffd152','sung':'#ffe890','cloud':'#ffffff','cloudb':'#dbeaf3',
    'hfar':'#c2e39c','hmid':'#9fd07c','hfrt':'#7cbb5f','hgrass':'#6aa850','hdark':'#5a9444',
    'gdot':'#8cc96a','trunk':'#86562f','c1':'#4f9b3f','c2':'#3c8531',
    'path':'#e8d7a6','pathb':'#dcc78c','fred':'#e0574a','fyel':'#ffd152','stem':'#4f8a44',
}

grid = [['s0' for _ in range(W)] for _ in range(H)]

# --- sky bands ---
bands = [(0,9,'s0'),(10,16,'s1'),(17,22,'s2'),(23,25,'s3')]
for y0,y1,c in bands:
    for y in range(y0,y1+1):
        for x in range(W):
            grid[y][x]=c
# ordered dithering at each band boundary (2-row checker into the band above)
for (_,y1,_),(ny0,_,nc) in zip(bands[:-1],bands[1:]):
    for x in range(W):
        if (x+y1)%2==0: grid[y1][x]=nc          # speckle next colour up

# --- sun ---
scx,scy,sr = 80,12,9
for y in range(scy-sr,scy+sr+1):
    for x in range(scx-sr,scx+sr+1):
        if 0<=x<W and 0<=y<24:
            d=(x-scx)**2+((y-scy)*1.0)**2
            if d<= (sr-3)**2: grid[y][x]='sun'
            elif d<= sr*sr: grid[y][x]='sung'
for rx,ry in [(scx-12,scy),(scx+12,scy),(scx,scy-12),(scx,scy+12),(scx-9,scy-9),(scx+9,scy-9),(scx-9,scy+9),(scx+9,scy+9)]:
    if 0<=rx<W and 0<=ry<24: grid[ry][rx]='sung'

# --- clouds (blocky sprites) ---
CLOUD = ["  ####  "," ###### ","########"," #####  "]
def stamp(sprite, ox, oy, fill, shadow=None):
    for j,row in enumerate(sprite):
        for i,ch in enumerate(row):
            if ch!=' ':
                x,y=ox+i,oy+j
                if 0<=x<W and 0<=y<H:
                    grid[y][x]= shadow if (shadow and j==len(sprite)-1) else fill
for ox,oy in [(10,7),(34,13),(50,19),(20,20)]:
    stamp(CLOUD, ox, oy, 'cloud', 'cloudb')

# --- hills (layered, rolling tops) ---
def fill_hill(top_fn, color):
    for x in range(W):
        t=top_fn(x)
        for y in range(t,H):
            grid[y][x]=color
front_top=[35+int(2.8*math.sin(x/6.0+2.4)) for x in range(W)]
fill_hill(lambda x:26+int(2.4*math.sin(x/9.0)),       'hfar')
fill_hill(lambda x:30+int(2.6*math.sin(x/7.0+1.3)),   'hmid')
fill_hill(lambda x:front_top[x],                       'hfrt')
# foreground darker grass + texture
for x in range(W):
    for y in range(35,H):
        if y>=H-4: grid[y][x]='hgrass'
        if y>=H-2: grid[y][x]='hdark'
    for y in range(36,H):
        if h(x,y)>0.86: grid[y][x]='gdot'

# --- trees ---
CANOPY=[" ## "," #### ","######","######"," #### "]
def tree(x0):
    base=front_top[x0]+1          # sit the trunk on the front ridge
    for y in range(base-1, base+3):
        if 0<=y<H: grid[y][x0]='trunk'
    for j,row in enumerate(CANOPY):
        for i,ch in enumerate(row):
            if ch!=' ':
                x,y=x0-2+i, base-6+j
                if 0<=x<W and 0<=y<H:
                    grid[y][x]= 'c1' if (i+j)%2==0 else 'c2'
for tx in (16,38,70,88): tree(tx)

# --- path ---
for y in range(40,H):
    cx=48+int(7*math.sin((y-40)/3.0))
    for x in (cx,cx+1):
        if 0<=x<W: grid[y][x]= 'path' if x==cx else 'pathb'

# --- flowers ---
for fx,fy,fc in [(14,H-3,'fred'),(30,H-2,'fyel'),(58,H-3,'fred'),(40,H-2,'fyel')]:
    if fy+1<H: grid[fy+1][fx]='stem'
    grid[fy][fx]=fc

# --- emit RLE svg ---
def svg(grid,name):
    out=[f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W*CELL} {H*CELL}" '
         f'preserveAspectRatio="xMidYMax slice" shape-rendering="crispEdges">']
    for y in range(H):
        x=0
        while x<W:
            c=grid[y][x]; x2=x
            while x2<W and grid[y][x2]==c: x2+=1
            out.append(f'<rect x="{x*CELL}" y="{y*CELL}" width="{(x2-x)*CELL}" height="{CELL}" fill="{PAL[c]}"/>')
            x=x2
    out.append('</svg>')
    return ''.join(out)

os.makedirs('docs', exist_ok=True)
open('docs/hero-pixels.svg','w').write(svg(grid,'hero'))
print('wrote docs/hero-pixels.svg', os.path.getsize('docs/hero-pixels.svg'),'bytes')
