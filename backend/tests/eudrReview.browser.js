// Production build and intercepted synthetic APIs only; no OMS/Wasabi requests.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http"),puppeteer=require("puppeteer");
const root=path.resolve(__dirname,"../../client/OMS/dist"),output=path.resolve(__dirname,"../../output/eudr-review");
const A="111111111111111111111111",C="222222222222222222222222",P="333333333333333333333333",G="444444444444444444444444",V="555555555555555555555555";
const user={_id:"aaaaaaaaaaaaaaaaaaaaaaaa",id:"aaaaaaaaaaaaaaaaaaaaaaaa",name:"Review admin",role:"super_admin"};
const species=[{_id:A,name:"Mango",scientific_name:"Mangifera indica",active:true,max_yield_bp:6500}],rules={revision:1,exporter_wastage_bp:1500};
const vendor={_id:V,name:"Shipping vendor",gst:"08AAJFM6604Q1ZO",pan:"AAJFM6604Q"};
const rows=[{source:"order",source_id:"666666666666666666666666",shipment_id:"777777777777777777777777",code:"TABLE",quantity:10,timber_cft:5.6,line_milli_cft:56000,hs_code:"940360",species_composition:[{species:A,share_bp:10000}],net_weight_kg_per_unit:11}];
const caution={code:"WASTAGE:make",text:"Recorded factory wastage is below the usual value",accepted:null};
const review={status:["Caution: low wastage","warn"],exportedMilliCft:56000,vendor_name:vendor.name,numberIssues:[],cautions:[caution],checkIssues:[],missing:[],notReviewableReasons:[],final_blockers:[caution.text],report_status:"Not sent",request_text:"To: Shipping vendor\nSubject: Documents needed for EUDR file — container TEST\n\nB. Please confirm\n1. Please explain recorded low wastage.",species:[{species:A,name:"Mango",scientific_name:"Mangifera indica",network_key:"network-1",maxYieldBp:6500,steps:[{label:"Finished documented output supporting containers",have:56000,need:null},{label:"Logs felled",have:100000,need:86154,gap:13846}],extra:[{ok:true,text:"Recorded sawing yield 65%"},{ok:false,warn:true,text:caution.text}]}]};
const chain={_id:C,container:"TEST",vendor,declared_milli_cft:56000,contribution_milli_cft:56000,stuffed_cft:56,inventory_backed:true,inventory_status:"RESERVED",complete:false,stages:[],history:[],shipment_rows:rows,excluded:[],unassigned:[],coverage:{chain_count:1,allocated_cft:56,remaining_cft:0,verified_cft:0,complete:false},review};
const parties=[{_id:G,kind:"generator",role:"Generator",name:"Generator",fields:{pan:"ABCDE1234F",place:"Village"},gst_snapshot:{status:"Unregistered"},revision:1}];
const plots=[{_id:P,generator:G,village:"Village",area_ha:2,coords:[[26,73]],satellite:{result:"Pass",forest_2020:"Not forest (simulated)",simulated:true,provider:"Simulated satellite",loss_ha:0},revision:1}];
const requests=[],errors=[];let sent=false;
const server=http.createServer((req,res)=>{let file=path.resolve(root,"."+decodeURIComponent(new URL(req.url,"http://localhost").pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,"index.html");res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"})[path.extname(file)]||"application/octet-stream");fs.createReadStream(file).pipe(res);});
(async()=>{
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin=`http://127.0.0.1:${server.address().port}`;
  const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||["Google/Chrome/Application/chrome.exe","Microsoft/Edge/Application/msedge.exe"].map(p=>path.join(process.env.PROGRAMFILES||"",p)).find(p=>fs.existsSync(p));
  const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage();page.on("pageerror",e=>errors.push(e.message));await page.setViewport({width:1440,height:1100});await page.setRequestInterception(true);
    page.on("request",async request=>{
      const url=new URL(request.url());if(["blob:","data:"].includes(url.protocol))return request.continue();if((request.isNavigationRequest()||url.pathname.startsWith("/assets/"))&&url.origin===origin)return request.continue();
      const route=url.pathname.replace(/^\/api/,""),method=request.method(),body=request.postData()?JSON.parse(request.postData()):{};
      const headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true","Access-Control-Allow-Headers":"content-type,authorization","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,OPTIONS","Cache-Control":"private, no-store"};
      const respond=(data,status=200)=>request.respond({status,contentType:"application/json",headers,body:JSON.stringify(data)});
      if(method==="OPTIONS")return respond({});
      if(url.pathname.endsWith("bootstrap.min.css")||url.pathname.endsWith("bootstrap.bundle.min.js")){const css=url.pathname.endsWith(".css");return request.respond({status:200,contentType:css?"text/css":"text/javascript",body:fs.readFileSync(path.resolve(__dirname,"../../client/OMS/node_modules/bootstrap/dist/"+(css?"css/bootstrap.min.css":"js/bootstrap.bundle.min.js")))});}
      if(route.startsWith("/auth/"))return respond({user});if(route==="/permissions/me")return respond({role:user.role,permissions:{}});if(route.startsWith("/notifications"))return respond({data:[],unreadCount:0});
      if(route.startsWith("/eudr"))requests.push({route,method,body});
      if(route==="/eudr/capabilities")return respond({data:{review_layer:true}});
      if(route==="/eudr"&&method==="GET")return respond({data:[{...chain,contribution_cft:56,declared_cft:56}]});
      if(route===`/eudr/${C}`&&method==="GET")return respond({data:chain});
      if(route===`/eudr/${C}/caution`){caution.accepted={reason:body.reason};review.status=["Complete","good"];review.final_blockers=[];return respond({data:caution});}
      if(route===`/eudr/${C}/requests`)return respond({data:{logged:true}});
      if(route===`/eudr/${C}/declaration-lines`){chain.declaration_lines=body.lines;return respond({data:chain});}
      if(route==="/eudr/species"&&method==="GET")return respond({data:{species,rules_revision:rules.revision}});
      if(route==="/eudr/species"&&method==="POST"){species.push({_id:"888888888888888888888888",...body,active:true});rules.revision++;return respond({data:species.at(-1)});}
      if(route==="/eudr/rules"&&method==="GET")return respond({data:rules});
      if(route==="/eudr/rules/preview")return respond({data:{changed_containers:1,changed_groups:1,revision:rules.revision}});
      if(route==="/eudr/rules"&&method==="PUT"){rules.exporter_wastage_bp=body.exporter_wastage_bp;rules.revision++;return respond({data:rules});}
      if(route==="/eudr/parties/gst-lookup")return respond({data:{status:"Active",legal_name:"Mahaveer Timber Mart",address:"Jodhpur",pan:"AAJFM6604Q",provider:"Simulated GST registry",simulated:true}});
      if(route==="/eudr/parties"&&method==="GET")return respond({data:{parties,vendors:[vendor]}});
      if(route==="/eudr/parties"&&method==="POST"){parties.push({_id:"999999999999999999999999",...body,fields:{gst:body.gstin,pan:body.pan,place:body.place},gst_snapshot:{status:"Active",simulated:true}});return respond({data:parties.at(-1)});}
      if(route==="/eudr/plots"&&method==="GET")return respond({data:plots});
      if(route==="/eudr/plots"&&method==="POST"){plots.push({_id:"bbbbbbbbbbbbbbbbbbbbbbbb",...body,coords:body.coords.split("\n").map(l=>l.split(",").map(Number)),area_ha:Number(body.declared_area_ha),satellite:{result:"Pending"}});return respond({data:plots.at(-1)});}
      if(method==="PATCH"&&route.startsWith("/eudr/plots/")){Object.assign(plots.find(p=>route.endsWith(p._id)),body,{coords:body.coords.split("\n").map(l=>l.split(",").map(Number))});return respond({data:plots[0]});}
      if(method==="PATCH"&&route.startsWith("/eudr/parties/")){const p=parties.find(p=>route.endsWith(p._id));Object.assign(p,{name:body.name,role:body.role});p.fields.place=body.place;return respond({data:p});}
      if(route.startsWith("/eudr/plots/")&&route.endsWith("satellite-check"))return respond({data:plots[0]});
      if(route==="/eudr/report"&&method==="GET")return respond({data:{ready:sent?[]:[{container_key:"test",vendor:V,review:{...review,status:["Complete","good"]}}],not_ready:[],already_sent:sent?[{container_key:"test",vendor:V,review:{...review,status:["Sent to Europe office","neutral"]}}]:[],lines:[{container:"TEST",vendor:vendor.name,hs_code:"940360",product_description:"Mango table",quantity_units:10,net_mass_kg:110,volume_m3:1.586,scientific_name:"Mangifera indica",production_places:P}],csv:"container,vendor\r\nTEST,Shipping vendor",geojson:{type:"FeatureCollection",features:[]},submissions:[]}});
      if(route==="/eudr/report/submit"){sent=true;return respond({data:[{_id:"submission"}]});}
      return respond({data:[]});
    });
    const text=async()=>page.evaluate(()=>document.body.innerText);
    const click=async label=>{await page.waitForFunction(label=>[...document.querySelectorAll("button")].some(b=>b.textContent.trim()===label&&!b.disabled),{},label);await page.evaluate(label=>[...document.querySelectorAll("button")].find(b=>b.textContent.trim()===label).click(),label);};
    const fill=async(label,value)=>{await page.waitForFunction(label=>[...document.querySelectorAll("label")].some(l=>l.textContent.includes(label)&&l.querySelector("input,textarea,select")),{},label);const handle=await page.evaluateHandle(label=>[...document.querySelectorAll("label")].find(l=>l.textContent.includes(label)).querySelector("input,textarea,select"),label);await handle.asElement().focus();await page.keyboard.down("Control");await page.keyboard.press("A");await page.keyboard.up("Control");await page.keyboard.type(value);};
    await page.goto(origin+"/eudr");await page.waitForFunction(()=>document.body.innerText.includes("Ready for Europe office"));
    assert.ok((await text()).includes("Recent container/vendor groups"));await click("Open");await page.waitForFunction(()=>document.body.innerText.includes("Network-level; not attributed to this container"));
    await fill("Reason for accepting","Recorded factory review");await click("Accept caution");await page.waitForFunction(()=>document.body.innerText.includes("Accepted: Recorded factory review"));
    await click("Write document request");await fill("Request text","Edited vendor request");await click("Copy text");await click("Mark as sent");await page.waitForFunction(()=>!document.querySelector("dialog[open]"));assert.ok(requests.some(r=>r.route.endsWith("/requests")&&r.body.text==="Edited vendor request"));
    await Promise.all([page.waitForResponse(r=>r.url().endsWith("declaration-lines")&&r.request().method()==="PUT"),click("Save declaration lines")]);assert.ok(requests.some(r=>r.method==="PUT"&&r.route.endsWith("declaration-lines")));
    await click("Back to Containers");await click("Rules");await page.waitForFunction(()=>document.body.innerText.includes("Mangifera indica"));await click("Preview changes");await page.waitForFunction(()=>document.body.innerText.includes("1 containers (1 vendor groups)"));await click("Save rules");await page.waitForFunction(()=>!document.querySelector("dialog[open]"));
    await click("Parties & plots");await page.waitForFunction(()=>document.body.innerText.includes("Generator"));await click("Add party");await fill("GSTIN","08AAJFM6604Q1ZO");await click("Fetch");await page.waitForFunction(()=>document.body.innerText.includes("Simulated GST registry"));await click("Save");await page.waitForFunction(()=>!document.querySelector("dialog[open]"));
    await click("Add plot");await page.waitForSelector("dialog[open] select");await page.select("dialog[open] select",G);await fill("Village","New village");await fill("Declared area","2");await fill("Coordinates","26, 73");await click("Save");await page.waitForFunction(()=>document.body.innerText.includes("New village"));
    await click("Edit party");await fill("Address","Updated village address");await click("Save");await page.waitForFunction(()=>document.body.innerText.includes("Updated village address"));
    await click("Edit plot");await fill("Village","Updated village");await click("Save");await page.waitForFunction(()=>document.body.innerText.includes("Updated village"));
    await click("View satellite imagery");await page.waitForFunction(()=>document.body.innerText.includes("Simulated imagery placeholder"));await page.keyboard.press("Escape");
    await click("Europe report");await page.waitForFunction(()=>document.body.innerText.includes("Mango table"));for(const label of ["Copy CSV","Download CSV","Copy GeoJSON","Download GeoJSON"])await click(label);await click("Mark 1 sent");await page.waitForFunction(()=>document.body.innerText.includes("Sent to Europe office"));
    fs.mkdirSync(output,{recursive:true});await page.screenshot({path:path.join(output,"report-desktop.png"),fullPage:true});await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(output,"report-mobile.png"),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1));assert.deepEqual(errors,[]);
    console.log("EUDR review browser passed: statuses, network table, caution, editable letter, declaration, rules preview, GST/plot forms, report exports and responsive layout.");
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
