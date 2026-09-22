from PIL import Image, ImageDraw, ImageFont
F='/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed-Bold.ttf'
G1=(29,106,62); G2=(33,117,71); LINE=(255,255,255,120); INK=(20,32,26)
def draw(size, maskable=False, rounded=True):
    S=size*4
    im=Image.new('RGBA',(S,S),(0,0,0,0))
    d=ImageDraw.Draw(im)
    r=int(S*0.22) if (rounded and not maskable) else 0
    # background with stripes
    bg=Image.new('RGBA',(S,S),G1+(255,))
    bd=ImageDraw.Draw(bg)
    n=6
    for i in range(n):
        if i%2: bd.rectangle([0,i*S//n,S,(i+1)*S//n],fill=G2+(255,))
    ov=Image.new('RGBA',(S,S),(0,0,0,0)); od=ImageDraw.Draw(ov)
    w=max(2,S//90)
    od.line([(0,S//2),(S,S//2)],fill=LINE,width=w)
    cr=int(S*0.30)
    od.ellipse([S//2-cr,S//2-cr,S//2+cr,S//2+cr],outline=LINE,width=w)
    bg=Image.alpha_composite(bg,ov)
    mask=Image.new('L',(S,S),0); ImageDraw.Draw(mask).rounded_rectangle([0,0,S-1,S-1],radius=r,fill=255)
    im.paste(bg,(0,0),mask)
    d=ImageDraw.Draw(im)
    # token
    tr=int(S*(0.22 if maskable else 0.27))
    ring=int(tr*0.16)
    d.ellipse([S//2-tr-ring,S//2-tr-ring,S//2+tr+ring,S//2+tr+ring],fill=(224,138,8,255))
    d.ellipse([S//2-tr,S//2-tr,S//2+tr,S//2+tr],fill=(255,255,255,255))
    font=ImageFont.truetype(F,int(tr*1.15))
    t='11'
    bb=d.textbbox((0,0),t,font=font)
    d.text((S//2-(bb[0]+bb[2])/2,S//2-(bb[1]+bb[3])/2),t,font=font,fill=INK)
    return im.resize((size,size),Image.LANCZOS)
import os
OUT=os.path.join(os.path.dirname(os.path.abspath(__file__)),'..','..','..','docs','schiera','icons')
os.makedirs(OUT,exist_ok=True)
p=lambda n: os.path.join(OUT,n)
draw(192).save(p('icon-192.png'))
draw(512).save(p('icon-512.png'))
draw(512,maskable=True).save(p('icon-maskable-512.png'))
a=draw(180,rounded=False); bgc=Image.new('RGBA',a.size,G1+(255,)); Image.alpha_composite(bgc,a).convert('RGB').save(p('apple-touch-icon.png'))
draw(32).save(p('favicon-32.png'))
print('ok')
