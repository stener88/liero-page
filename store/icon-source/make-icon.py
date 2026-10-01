from PIL import Image, ImageDraw
import math, random
C = {'bg':(20,17,28,255),'W':(244,240,232,255),'Ws':(214,208,198,255),'g':(150,146,160,255),'k':(35,32,44,255),
 'b':(118,76,42,255),'B':(66,41,23,255),'d':(150,100,56,255),'y':(255,210,63,255),'o':(255,140,40,255),'w':(255,252,230,255),
 'r':(255,90,95,255),'R':(196,46,58,255),'h':(255,160,160,255),'e':(255,255,255,255),'p':(20,17,28,255),
 'rope1':(214,170,100,255),'rope2':(150,108,60,255)}
WORM = [  # 7 wide, 8 tall, facing right
 "..hrr..",
 ".hrrrr.",
 ".rrrep.",
 ".rrrrr.",
 "..rrR..",
 ".rrR...",
 "rrRr...",
 "RRR....",
]
def art(n=24):
    im = Image.new('RGBA',(n,n),(0,0,0,0)); px=im.load()
    def put(x,y,c):
        if 0<=x<n and 0<=y<n: px[x,y]=C[c] if isinstance(c,str) else c
    P0,P1,Q0,Q1 = 2,17,3,22
    for y in range(Q0,Q1+1):
        for x in range(P0,P1+1): put(x,y,'W')
    for y in range(Q0+1,Q1+2): put(P1+1,y,'k')     # page shadow
    for x in range(P0+1,P1+2): put(x,Q1+1,'k')
    for x in range(4,13): put(x,5,'k'); put(x,6,'k')
    for y,(a,bx) in {9:(4,15),11:(4,12),13:(4,15),15:(4,9),17:(4,14),19:(4,11)}.items():
        for x in range(a,bx+1): put(x,y,'g')
    random.seed(3)
    cx0, cy0, R = 16.0, 11.5, 6.2
    for y in range(n):
        for x in range(n):
            dd=math.hypot(x-cx0,y-cy0)
            if dd<=R and P0<=x<=P1+1 and Q0<=y<=Q1+1:
                put(x,y,'B' if dd>R-1.15 else ('d' if random.random()<0.22 else 'b'))
    # rope from worm to top-right
    sx,sy,ex,ey = 16,9,22,1
    for i in range(41):
        x=round(sx+(ex-sx)*i/40); y=round(sy+(ey-sy)*i/40); put(x,y,'rope1' if (x+y)%2 else 'rope2')
    for (x,y,c) in [(22,1,'w'),(23,1,'y'),(22,0,'y'),(21,1,'o'),(22,2,'o')]: put(x,y,c)
    ox,oy = 11,9
    for j,row in enumerate(WORM):
        for i,ch in enumerate(row):
            if ch!='.': put(ox+i,oy+j,ch)
    # debris
    for (x,y,c) in [(20,6,'W'),(21,9,'d'),(19,4,'b'),(22,12,'W'),(21,15,'b')]: put(x,y,c)
    return im
def tile(size, art_px, pad):
    out = Image.new('RGBA',(size,size),(0,0,0,0))
    dr = ImageDraw.Draw(out)
    dr.rounded_rectangle([pad,pad,size-1-pad,size-1-pad], radius=round((size-2*pad)*0.2), fill=C['bg'])
    a = art().resize((size-2*pad,)*2, Image.NEAREST)
    # keep art inside the tile shape
    mask = Image.new('L',(size,size),0); ImageDraw.Draw(mask).rounded_rectangle([pad,pad,size-1-pad,size-1-pad], radius=round((size-2*pad)*0.2), fill=255)
    layer = Image.new('RGBA',(size,size),(0,0,0,0)); layer.paste(a,(pad,pad),a)
    out.alpha_composite(Image.composite(layer, Image.new('RGBA',(size,size),(0,0,0,0)), mask))
    return out
big = tile(192, 0, 0)
big.save('p3.png')

WORM16 = ["hr.", "rre", "rr.", ".R.", "rR.", "R.."]
def art16():
    n=16; im=Image.new('RGBA',(n,n),(0,0,0,0)); px=im.load()
    def put(x,y,c):
        if 0<=x<n and 0<=y<n: px[x,y]=C[c]
    for y in range(n):
        for x in range(n):
            cx=min(x,n-1-x); cy=min(y,n-1-y)
            if (cx,cy) in [(0,0),(1,0),(0,1)]: continue
            put(x,y,'bg')
    for y in range(2,15):
        for x in range(1,12): put(x,y,'W')
    for x in range(3,8): put(x,4,'k')
    for y,(a,b) in {7:(3,10),9:(3,8),11:(3,10),13:(3,7)}.items():
        for x in range(a,b+1): put(x,y,'g')
    for y in range(n):
        for x in range(n):
            dd=math.hypot(x-11.5,y-8)
            if dd<=4.3 and 1<=x<=12 and 2<=y<=14: put(x,y,'B' if dd>3.3 else 'b')
    for i in range(9):
        x=round(11+(15-11)*i/8); y=round(5+(0-5)*i/8); put(x,y,'rope1')
    put(15,0,'y')
    for j,row in enumerate(WORM16):
        for i,ch in enumerate(row):
            if ch!='.': put(9+i,5+j,ch)
    return im
import os
os.makedirs('out',exist_ok=True)
tile(128,0,16).save('out/128.png')
a=art()
t48=tile(48,0,0); t48.save('out/48.png')
art16().save('out/16.png')
prev=Image.new('RGBA',(128+48+16+40,128),(240,240,240,255))
prev.paste(Image.open('out/128.png'),(0,0),Image.open('out/128.png'))
prev.paste(Image.open('out/48.png'),(140,40),Image.open('out/48.png'))
prev.paste(Image.open('out/16.png'),(200,56),Image.open('out/16.png'))
prev=prev.resize((prev.width*2,prev.height*2),Image.NEAREST); prev.save('prev_all.png')
art16().resize((128,128),Image.NEAREST).save('p16big.png')
