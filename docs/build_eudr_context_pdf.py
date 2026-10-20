"""Build the current EUDR reference from its narrative and live Mongoose schemas."""
from pathlib import Path
import hashlib
import html
import json
import re
import subprocess
import textwrap

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, PageBreak,
    Table, TableStyle, Image, Flowable, Preformatted, KeepTogether,
)
from reportlab.platypus.tableofcontents import TableOfContents

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "output" / "pdf" / "EUDR_Current_Management_Full_Context.pdf"
TMP = ROOT / "tmp" / "pdfs" / "eudr-current-context"
W, H = A4
MARGIN = 42
BODY = W - 2 * MARGIN
GREEN = colors.HexColor("#214D43")
INK = colors.HexColor("#24332F")
MUTED = colors.HexColor("#62746C")
PALE = colors.HexColor("#EFF4EF")
GOLD = colors.HexColor("#B59558")

for name, file in [("Body", "segoeui.ttf"), ("Bold", "segoeuib.ttf"), ("Italic", "segoeuii.ttf")]:
    pdfmetrics.registerFont(TTFont(name, "C:/Windows/Fonts/" + file))
pdfmetrics.registerFontFamily("Body", normal="Body", bold="Bold", italic="Italic", boldItalic="Bold")
ST = getSampleStyleSheet()
ST.add(ParagraphStyle("Text", fontName="Body", fontSize=9.2, leading=13, textColor=INK, spaceAfter=6.5))
ST.add(ParagraphStyle("Chapter", fontName="Bold", fontSize=20, leading=25, textColor=GREEN, spaceAfter=17, keepWithNext=True))
ST.add(ParagraphStyle("Sub", fontName="Bold", fontSize=12.3, leading=16, textColor=GREEN, spaceBefore=13, spaceAfter=8, keepWithNext=True))
ST.add(ParagraphStyle("Cell", fontName="Body", fontSize=8.1, leading=11.5, textColor=INK, wordWrap="CJK"))
ST.add(ParagraphStyle("SchemaCell", parent=ST["Cell"], fontSize=8, leading=10.5))
ST.add(ParagraphStyle("Small", parent=ST["Text"], fontSize=7.7, leading=10.7, textColor=MUTED))
ST.add(ParagraphStyle("Th", parent=ST["Cell"], fontName="Bold", textColor=colors.white))
ST.add(ParagraphStyle("CodeBlock", fontName="Courier", fontSize=7.1, leading=10, textColor=INK, backColor=PALE, borderPadding=8, spaceBefore=5, spaceAfter=10))
ST.add(ParagraphStyle("Contents", fontName="Body", fontSize=9.2, leading=14.8, textColor=GREEN, leftIndent=0, firstLineIndent=0, spaceBefore=4))
ST.add(ParagraphStyle("BulletText", parent=ST["Text"], leftIndent=12, firstLineIndent=-9))

def p(text, style="Text"):
    return Paragraph(html.escape(str(text)).replace("\n", "<br/>"), ST[style])

def table(rows, widths=None, compact=False):
    header = [p(x, "Th") for x in rows[0]]
    data = [header] + [[p(x, "SchemaCell" if compact else "Cell") for x in row] for row in rows[1:]]
    if widths is None:
        widths = [BODY * .29] + [BODY * .71 / (len(rows[0]) - 1)] * (len(rows[0]) - 1)
        if len(rows[0])==3:widths=[BODY*.20,BODY*.40,BODY*.40]
    result = Table(data, colWidths=widths, repeatRows=1, hAlign="LEFT")
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), GREEN),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 3.5 if compact else 4.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3.5 if compact else 4.5),
        ("LINEBELOW", (0, 0), (-1, 0), .5, GOLD),
        ("LINEBELOW", (0, 1), (-1, -1), .25, colors.HexColor("#D9E3DC")),
    ]))
    return result

class Diagram(Flowable):
    def __init__(self, kind):
        Flowable.__init__(self)
        self.kind = kind
        self.width = BODY
        self.height = {"ARCHITECTURE": 270, "STAGE_FLOW": 170, "CONTAINER_FLOW": 180,
                       "MIX_EXAMPLE": 230, "LIFECYCLE": 180, "DATA_MODEL": 390}[kind]

    def draw(self):
        c = self.canv
        def box(x, y, w, h, label, small="", dark=False):
            c.setFillColor(GREEN if dark else PALE)
            c.setStrokeColor(GREEN if dark else colors.HexColor("#C7D8CD"))
            c.roundRect(x, y, w, h, 7, fill=1, stroke=1)
            lines = textwrap.wrap(label, max(15, int(w / 5.6)))
            c.setFillColor(colors.white if dark else GREEN)
            c.setFont("Bold", 9)
            top = y + h - 17
            for line in lines:
                c.drawCentredString(x+w/2, top, line)
                top -= 12
            c.setFont("Body", 8)
            c.setFillColor(colors.white if dark else INK)
            for line in textwrap.wrap(small, max(15, int(w / 4.5))):
                c.drawCentredString(x+w/2, top-4, line)
                top -= 10
        def arrow(x1,y1,x2,y2,label=""):
            c.setStrokeColor(MUTED)
            c.setLineWidth(1)
            c.line(x1,y1,x2,y2)
            import math
            angle = math.atan2(y2-y1,x2-x1)
            for delta in [-.45,.45]:
                c.line(x2,y2,x2-7*math.cos(angle+delta),y2-7*math.sin(angle+delta))
            if label:
                c.setFillColor(MUTED);c.setFont("Body",7)
                c.drawCentredString((x1+x2)/2,(y1+y2)/2+6,label)
        if self.kind == "ARCHITECTURE":
            box(0,195,150,60,"Containers + chain review","React /eudr",True)
            box(180,195,150,60,"Inventory workflows","Shared documentary ledger",True)
            box(360,195,150,60,"Evidence workspace","Preview / original download",True)
            for x in [75,255,435]: arrow(x,195,x,155)
            box(0,95,510,60,"Authenticated Express /eudr APIs","Role checks + revision checks + transactional services")
            arrow(100,95,100,65);arrow(350,95,350,65)
            box(0,0,220,65,"MongoDB","Chains + canonical ledger + locks + audit")
            box(270,0,240,65,"Private Wasabi + preview runtime","Shared originals / content-hash PDF previews")
        elif self.kind == "STAGE_FLOW":
            for x,label in [(0,"Sawmill"),(180,"Transport"),(360,"Receiver")]:
                box(x,90,150,65,label,"Manual review + evidence",x==0)
            arrow(150,122,180,122);arrow(330,122,360,122)
            box(360,0,150,55,"Declaration","When receiver matches vendor")
            arrow(435,90,435,55)
            arrow(360,80,255,55,"Otherwise onward sale")
            box(180,0,150,55,"Next transport","Then another receiver")
        elif self.kind == "CONTAINER_FLOW":
            labels=[("Verified FINISHED lots","Shared vendor capacities"),("Reserve contribution","Counts against competitors"),("Manual declaration","Evidence + quantity + origin")]
            for index,(label,sub) in enumerate(labels):
                x=index*180;box(x,90,150,75,label,sub,index==1)
                if index<2:arrow(x+150,127,x+180,127)
            box(0,0,510,60,"COMMITTED container allocation","Live stuffing dates, missing Timber_CFT and exact coverage still checked")
            arrow(435,90,435,60)
        elif self.kind == "MIX_EXAMPLE":
            box(0,145,145,65,"Invoice A: 500","Possible use 300-500")
            box(0,35,145,65,"Invoice B: 300","Possible use 100-300")
            box(205,90,150,80,"UNKNOWN sale: 600","No historical split invented",True)
            arrow(145,177,205,145);arrow(145,67,205,117)
            box(395,90,115,80,"Buyer receipt","600, used downstream once")
            arrow(355,130,395,130)
            c.setFont("Bold",10);c.setFillColor(GREEN)
            c.drawString(0,8,"Combined remaining: 200. Individual 0-200 maxima are NOT additive.")
        elif self.kind == "LIFECYCLE":
            for i,(label,sub) in enumerate([("DRAFT","No spendable output"),("RESERVED","Demand competes"),("COMMITTED","Verified historical use")]):
                x=i*180;box(x,95,150,65,label,sub,i==2)
                if i<2:arrow(x+150,127,x+180,127)
            box(180,0,150,60,"ON_HOLD","Usage retained; review required")
            arrow(435,95,300,60,"Dispute / correction")
            box(0,0,150,60,"CANCELLED","Audited dependency reversal")
            arrow(180,30,150,30)
        elif self.kind == "DATA_MODEL":
            for x,y,label,sub in [
                (0,310,"SourceBatch","One root quantity"),(180,310,"Invoice","One permanent identity"),(360,310,"Document","Shared private file"),
                (0,190,"Lot","One holder/material"),(180,190,"Transfer","One movement + receipt"),(360,190,"Mix","References lots, no supply"),
                (0,70,"Commitment","One chain contribution"),(180,70,"EudrChain","Container review"),(360,70,"Audit + Review + State","History, migration, global lock")]:
                box(x,y,150,65,label,sub,label in ["Invoice","Lot","Commitment"])
            arrow(75,310,75,255,"root")
            arrow(255,310,255,255,"line cap")
            arrow(150,222,180,222,"inputs")
            arrow(180,197,150,197,"output")
            arrow(360,222,330,222,"linked sale")
            arrow(75,190,75,135,"finished inputs")
            arrow(150,102,180,102,"chain")
            arrow(435,310,435,255,"evidence")
            c.setFont("Body",8);c.setFillColor(MUTED)
            c.drawString(0,30,"Document references also attach to sources, invoices, lots, transfers, mixes and audit snapshots.")
            c.drawString(0,16,"Chain -> Vendor; Lot -> incoming transfer OR source. A mix never creates a second lot.")

def schema_snapshot():
    script = r"""
const mongoose=require("mongoose");
mongoose.set("autoIndex",false);mongoose.set("autoCreate",false);
const I=require("./models/eudrInventory.model");
const models=[require("./models/eudrChain.model"),require("./models/eudrParty.model"),require("./models/eudrAllocation.model"),...Object.values(I).filter(m=>m.schema)];
const output=[];
function fields(schema,prefix=""){
  const result=[];
  for(const [name,path] of Object.entries(schema.paths)){
    const o=path.options||{},r=[];
    if(o.required)r.push("Required");
    if(o.default!==undefined)r.push("Default: "+(typeof o.default==="function"?"factory / automatic":JSON.stringify(o.default)));
    if(o.enum)r.push("Enum: "+(Array.isArray(o.enum)?o.enum:o.enum.values).join(", "));
    if(o.ref)r.push("Ref: "+o.ref);
    if(o.min!==undefined)r.push("Min: "+o.min);
    if(o.max!==undefined)r.push("Max: "+o.max);
    if(o.trim)r.push("Trim");
    if(o.unique)r.push("Unique");
    if(o.index)r.push("Indexed");
    if(o.validate===Number.isSafeInteger)r.push("Safe integer");
    const child=path.getEmbeddedSchemaType?.()||path.embeddedSchemaType||path.$embeddedSchemaType||path.caster;
    if(child?.options?.ref)r.push("Element ref: "+child.options.ref);
    result.push({field:prefix+name,type:path.schema?(path.instance==="Array"?"Subdocument[]":"Subdocument"):path.instance==="Array"?(child?.instance||"Mixed")+"[]":path.instance,rules:r.join("; ")||"Optional / service validation"});
    if(path.schema)result.push(...fields(path.schema,prefix+name+(path.instance==="Array"?"[].":".")));
  }
  return result;
}
for(const m of models)output.push({model:m.modelName,collection:m.collection.name,options:{timestamps:!!m.schema.options.timestamps,optimisticConcurrency:!!m.schema.options.optimisticConcurrency},fields:fields(m.schema),indexes:m.schema.indexes()});
console.log(JSON.stringify(output));
"""
    result = subprocess.run(["node", "-e", script], cwd=ROOT/"backend", text=True, capture_output=True, check=True)
    return json.loads(result.stdout)

class ReferenceDoc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(str(path), pagesize=A4, leftMargin=MARGIN, rightMargin=MARGIN, topMargin=53, bottomMargin=45,
                         title="EUDR Timber Management - Full Current Context", author="Green House Sourcing OMS",
                         subject="Current workflows, UI, APIs, documentary inventory, schema dictionary and operations")
        self.section = "Current EUDR context"
        self.addPageTemplates(PageTemplate(id="main", frames=Frame(MARGIN,45,BODY,H-98,id="body",leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0),onPage=self.decorate))
    def decorate(self, canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setStrokeColor(GOLD);canvas.setLineWidth(.6);canvas.line(MARGIN,H-33,W-MARGIN,H-33)
            canvas.setFont("Bold",8);canvas.setFillColor(GREEN);canvas.drawString(MARGIN,H-25,"GREEN HOUSE SOURCING | EUDR MANAGEMENT")
            canvas.setFont("Body",7);canvas.setFillColor(MUTED)
            canvas.drawRightString(W-MARGIN,H-25,"CODE SNAPSHOT: 13 OCT 2026")
        canvas.setStrokeColor(colors.HexColor("#D9E3DC"));canvas.line(MARGIN,31,W-MARGIN,31)
        canvas.setFont("Body",7);canvas.setFillColor(MUTED)
        canvas.drawString(MARGIN,20,"Repository reference | Not physical-stock or legal certification")
        canvas.drawRightString(W-MARGIN,20,str(doc.page))
        canvas.restoreState()
    def afterFlowable(self, flowable):
        if isinstance(flowable,Paragraph) and flowable.style.name=="Chapter" and flowable.getPlainText()!="Contents":
            text=flowable.getPlainText()
            key="h-"+hashlib.sha1(text.encode()).hexdigest()[:14]
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(text,key,0,False)
            self.notify("TOCEntry",(0,text,self.page,key))

def screenshot(path, caption, max_height):
    if not path.exists():
        return [p("Screenshot not present in this checkout; the surrounding text documents the UI.", "Small")]
    from PIL import Image as PILImage
    with PILImage.open(path) as img:
        w,h=img.size
    scale=min(BODY/w,max_height/h)
    return [KeepTogether([Image(str(path),width=w*scale,height=h*scale,hAlign="LEFT"),Spacer(1,6),p(caption,"Small")]),Spacer(1,12)]

def narrative(story):
    lines=(ROOT/"docs"/"EUDR_CURRENT_CONTEXT.md").read_text(encoding="utf-8").splitlines()
    i=0
    while i<len(lines):
        line=lines[i].strip()
        if not line:
            i+=1;continue
        if line.startswith("# "):
            story.extend([PageBreak(),p(line[2:],"Chapter")]);i+=1;continue
        if line.startswith("## "):
            story.append(p(line[3:],"Sub"));i+=1;continue
        if line.startswith("[["):
            kind=line[2:-2]
            if kind=="PAGE_BREAK":
                story.append(PageBreak())
            elif kind=="LINEAGE_SCREEN":
                story.extend(screenshot(ROOT/".tmp"/"eudr-inventory-lineage.png","Implemented branching lineage interface. Isolated browser fixture / synthetic data; not a production record.",310))
            elif kind=="MOBILE_SCREEN":
                story.extend(screenshot(ROOT/".tmp"/"eudr-inventory-mobile.png","Mobile mixed-sale workflow. Isolated browser fixture; the full scrollable form continues below the screenshot.",400))
            else:
                story.extend([KeepTogether([Diagram(kind),Spacer(1,12)])])
            i+=1;continue
        if line.startswith("|"):
            rows=[]
            while i<len(lines) and lines[i].strip().startswith("|"):
                row=[x.strip() for x in lines[i].strip().strip("|").split("|")]
                if not all(re.fullmatch(r"[- :]+",x) for x in row):
                    rows.append(row)
                i+=1
            if any(len(r)!=len(rows[0]) for r in rows):
                raise ValueError("Malformed table: "+repr(rows))
            widths=[BODY*.31,BODY*.23,BODY*.23,BODY*.23] if len(rows[0])==4 else None
            story.extend([table(rows,widths),Spacer(1,12)]);continue
        if line.startswith(chr(96)*3):
            block=[];i+=1
            while i<len(lines) and not lines[i].startswith(chr(96)*3):
                block.extend(textwrap.wrap(lines[i],100,replace_whitespace=False,drop_whitespace=False) or [""])
                i+=1
            story.append(Preformatted("\n".join(block),ST["CodeBlock"]));i+=1;continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not lines[i].startswith(("#","|","[[",chr(96)*3)):
            paragraph.append(lines[i].strip());i+=1
        story.append(p(" ".join(paragraph)))

SOURCES = [
    "backend/models/eudrChain.model.js","backend/models/eudrParty.model.js","backend/models/eudrAllocation.model.js","backend/models/eudrInventory.model.js",
    "backend/controllers/eudrChain.controller.js","backend/controllers/eudrInventory.controller.js","backend/routers/eudrChain.routes.js",
    "backend/services/eudrChain.service.js","backend/services/eudrAllocation.service.js","backend/services/eudrDirectory.service.js",
    "backend/services/eudrInventory.service.js","backend/services/eudrQuantity.service.js","backend/services/eudrInventoryMigration.service.js",
    "backend/services/eudrFiles.service.js","backend/services/eudrPreview.service.js","backend/services/wasabiStorage.service.js","backend/services/convertXlsxToPDF.service.js",
    "backend/scripts/eudrInventoryMigration.js","backend/helpers/timberCft.js","backend/config/multer.config.js","backend/middlewares/auth.middleware.js",
    "backend/models/vendor.model.js","backend/models/item.model.js","backend/models/order.model.js","backend/models/sample.model.js",
    "client/OMS/src/pages/EudrTimber.jsx","client/OMS/src/components/eudr/EudrChainView.jsx","client/OMS/src/components/eudr/StageEditor.jsx",
    "client/OMS/src/components/eudr/SavedDetails.jsx","client/OMS/src/components/eudr/DocumentWorkspace.jsx","client/OMS/src/components/eudr/EudrDialog.jsx",
    "client/OMS/src/components/eudr/InventoryWorkspace.jsx","client/OMS/src/components/eudr/InventoryEditor.jsx","client/OMS/src/components/eudr/InventoryCommon.jsx",
    "client/OMS/src/components/eudr/InventoryRecordActions.jsx","client/OMS/src/components/eudr/documentStore.js","client/OMS/src/components/eudr/pdfRuntime.js",
    "client/OMS/src/utils/eudrDocuments.js","client/OMS/src/utils/eudrInventory.js","docs/EUDR_INVENTORY_IMPLEMENTATION.md",
]

def build():
    OUT.parent.mkdir(parents=True,exist_ok=True)
    TMP.mkdir(parents=True,exist_ok=True)
    schemas=schema_snapshot()
    story=[Spacer(1,55)]
    story.append(p("GREEN HOUSE SOURCING / OMS","Sub"))
    story.append(Paragraph("EUDR Timber<br/>Management",ParagraphStyle("Cover",fontName="Bold",fontSize=34,leading=40,textColor=GREEN,spaceAfter=18)))
    story.append(Paragraph("Full current context",ParagraphStyle("CoverSub",fontName="Body",fontSize=21,leading=27,textColor=INK,spaceAfter=24)))
    story.append(p("FUNCTIONAL REFERENCE + UI GUIDE + API CONTRACTS + COMPLETE EUDR SCHEMA DICTIONARY","Sub"))
    story.append(Spacer(1,22))
    story.append(p("Repository snapshot: 13 October 2026"))
    story.append(p("Includes container-stage traceability and the integrated document-backed inventory, mixed-source reconciliation and global allocations."))
    story.append(Spacer(1,27))
    story.append(table([["Read this document as","Do not read it as"],["The implementation present in the working repository, including its explicit UI and operating boundaries.","Confirmation of production deployment, external-party stock, physical composition or legal EUDR certification."]],[BODY/2,BODY/2]))
    story.append(Spacer(1,25))
    story.append(p("Prepared from live source definitions. Schema tables are generated directly from Mongoose; screenshots use isolated synthetic browser fixtures.","Small"))
    story.extend([PageBreak(),p("Contents","Chapter")])
    toc=TableOfContents()
    toc.levelStyles=[ST["Contents"]]
    toc.dotsMinLevel=0
    story.append(toc)
    narrative(story)
    story.extend([PageBreak(),p("Appendix A. Complete EUDR schemas","Chapter")])
    story.append(p("Exact structural dictionary generated from the current Mongoose models. Required/default values below describe schema declarations; additional service validation and conditional activation requirements are documented in the preceding chapters. ObjectId references are stored IDs, not duplicated capacity."))
    story.append(table([["Collection","Model","Fields incl. nested"],*[[s["collection"],s["model"],str(len(s["fields"]))] for s in schemas]],[BODY*.36,BODY*.48,BODY*.16]))
    for index,schema in enumerate(schemas,1):
        story.extend([Spacer(1,22),p("A."+str(index)+" "+schema["model"],"Chapter")])
        story.append(p("Collection: "+schema["collection"]))
        story.append(p("Automatic timestamps: "+str(schema["options"]["timestamps"])+" | Optimistic concurrency: "+str(schema["options"]["optimisticConcurrency"]),"Small"))
        story.extend([table([["Persisted field / nested path","Type","Definition"],*[[r["field"],r["type"],r["rules"]] for r in schema["fields"]]],[BODY*.34,BODY*.17,BODY*.49],compact=True),Spacer(1,10),p("Declared indexes","Sub")])
        indexes=schema["indexes"]
        if indexes:
            story.append(table([["Key pattern","Options"],*[[json.dumps(keys),json.dumps({k:v for k,v in opts.items() if k!="background"}) or "{}"] for keys,opts in indexes]],[BODY*.63,BODY*.37],compact=True))
        else:
            story.append(p("No additional declared schema index beyond MongoDB's normal _id index."))
        if schema["model"]=="EudrChain":
            story.append(p("The invoice_keys unique sparse declaration is conditional: included only when EUDR_CANONICAL_INVOICES is not true. This build introspects the legacy declaration, not production index state. Transitioning the actual database index is an explicit guarded migration.","Small"))
        if schema["model"] in ["EudrInventoryAudit","EudrMigrationReview","EudrInventoryState"]:
            story.append(p("Optimistic concurrency and timestamps are supplied by the shared model factory. Audit append-only behavior is enforced through application workflow; it is not a database administrator write prohibition.","Small"))
    story.extend([PageBreak(),p("Appendix B. Source map and snapshot","Chapter")])
    rev=subprocess.run(["git","rev-parse","--short","HEAD"],cwd=ROOT,text=True,capture_output=True).stdout.strip()
    story.append(p("Base Git revision: "+rev+". The PDF also describes uncommitted local implementation changes; the revision alone does not identify the whole snapshot. Source hashes below identify the files used at document build time."))
    rows=[["Repository-relative source","SHA-256 prefix"]]
    for source in SOURCES:
        path=ROOT/source
        if not path.is_file():raise FileNotFoundError(path)
        rows.append([source,hashlib.sha256(path.read_bytes()).hexdigest()[:20]])
    story.append(table(rows,[BODY*.72,BODY*.28]))
    story.extend([Spacer(1,15),p("Additional reference and reproducibility","Sub")])
    story.append(p("Historical context: docs/EUDR_Management_Summary.docx and docs/EUDR_Schema_and_System_Design.pdf. New architecture/migration guide: docs/EUDR_INVENTORY_IMPLEMENTATION.md. Narrative source: docs/EUDR_CURRENT_CONTEXT.md. PDF builder: docs/build_eudr_context_pdf.py."))
    story.append(p("Rebuild with the bundled Python runtime containing ReportLab and Node.js available on PATH. The builder introspects local Mongoose schemas without connecting to MongoDB, and never reads database connection settings. No production migration, document upload or application mutation is performed by this build."))
    story.append(p("Validation includes PDF text extraction, schema field coverage, page geometry and rendered page inspection. The reference intentionally distinguishes current UI controls from API-only functions and schema enum capability from implemented transitions."))
    doc=ReferenceDoc(OUT)
    doc.multiBuild(story)
    print(json.dumps({"output":str(OUT),"models":len(schemas),"schema_fields":sum(len(s["fields"]) for s in schemas)}))

if __name__=="__main__":
    build()
