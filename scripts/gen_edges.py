#!/usr/bin/env python3
"""Generate brushed/torn cream edge strips that frame the painting hero,
so it bleeds into the page like a mounted painting (Clove-style)."""
import random
random.seed(7)
W, H = 1440, 90
CREAM = "#fcf8f0"

def rough_edge(flip=False):
    # build a rough boundary across the width: gentle wave + jitter + occasional bristles
    pts=[]
    x=0
    base=44
    while x<=W:
        y = base + random.uniform(-7,7)
        if random.random()<0.10:        # a longer brush bristle reaching into the painting
            y += random.uniform(10,26)
        pts.append((x,y))
        x += random.randint(6,14)
    pts[0]=(0,pts[0][1]); pts[-1]=(W,pts[-1][1])
    # path: fill the cream region (top side) down to the rough boundary
    d="M0,0 L%d,0 "%W
    d+="L%d,%.1f "%(pts[-1][0],pts[-1][1])
    for x,y in reversed(pts[:-1]):
        d+="L%d,%.1f "%(x,y)
    d+="Z"
    transform = f'transform="translate(0,{H}) scale(1,-1)"' if flip else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" '
            f'preserveAspectRatio="none"><path {transform} d="{d}" fill="{CREAM}"/></svg>')

open('docs/edge-top.svg','w').write(rough_edge(flip=False))
open('docs/edge-bottom.svg','w').write(rough_edge(flip=True))
print('wrote docs/edge-top.svg, docs/edge-bottom.svg')
