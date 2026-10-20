// Production build + isolated intercepted API fixtures; never contacts OMS or Wasabi.
const assert=require("node:assert/strict"),fs=require("node:fs"),path=require("node:path"),http=require("node:http"),puppeteer=require("puppeteer");
const root=path.resolve(__dirname,"../../client/OMS/dist"),output=path.resolve(__dirname,"../../.tmp");
const user={_id:"aaaaaaaaaaaaaaaaaaaaaaaa",id:"aaaaaaaaaaaaaaaaaaaaaaaa",role:"super_admin",name:"Inventory reviewer"};
const vendor={_id:"bbbbbbbbbbbbbbbbbbbbbbbb",name:"Party X",gst:"08ABCDE1001F1Z5",pan:"ABCDE1001F"};
const buyer={_id:"cccccccccccccccccccccccc",name:"Boranada",gst:"08ABCDE1002F1Z5",pan:"ABCDE1002F"};
const ids={A:"111111111111111111111111",B:"222222222222222222222222",C:"333333333333333333333333",T:"444444444444444444444444",I:"555555555555555555555555",D:"666666666666666666666666",S:"777777777777777777777777"};
const document={_id:ids.D,name:"shared-invoice.png",content_type:"image/png",purpose:"invoice",sha256:"fixture-sha"};
const range={documented_milli:500000,committed_min_milli:300000,committed_max_milli:500000,uncommitted_min_milli:0,uncommitted_max_milli:200000};
const lot=(id,q,number)=>({_id:id,identity_key:"receipt:"+id,owner:vendor.gst+"|"+vendor.pan,holder_snapshot:{name:vendor.name},kind:"RECEIPT",material:"RAW",quantity_milli:q,status:"COMMITTED",verification:{status:"VERIFIED"},origin_status:"VERIFIED",documents:[ids.D],invoice:ids.I,invoice_detail:{number},quantity_range:range,quantity_status:"QUANTITY_FEASIBLE",revision:1});
const lots=[lot(ids.A,500000,"A500"),lot(ids.B,300000,"B300")];
const invoice={_id:ids.I,identity_key:"invoice-A",number:"A500",issuer_snapshot:{name:"Sawmill A"},buyer_snapshot:{name:vendor.name},date:"2026-10-01",lines:[{line_id:"1",quantity_milli:500000,material:"RAW"}],total_milli:500000,status:"COMMITTED",revision:1,documents:[ids.D],origin_status:"VERIFIED"};
const network={lots:[...lots,{...lot(ids.C,600000,"C600"),holder_snapshot:{name:buyer.name},incoming_operation:ids.T}],operations:[{_id:ids.T,kind:"TRANSFER",seller:vendor.gst+"|"+vendor.pan,buyer:buyer.gst+"|"+buyer.pan,inputs:[{lot:ids.A},{lot:ids.B}],output_lot:ids.C,mode:"UNKNOWN",quantity_milli:600000,status:"COMMITTED",origin_status:"VERIFIED"}],mixes:[],sources:[{_id:ids.S,origins:[{plot:"Forest A",latitude:26,longitude:73,permission:"P1"}]}],invoices:[invoice],documents:[document],potential_origins:[{plot:"Forest A",latitude:26,longitude:73,permission:"P1",source_batch:ids.S}],reconciliation:{feasible:true,status:"QUANTITY_FEASIBLE",ranges:[range,{...range,uncommitted_min_milli:200000,uncommitted_max_milli:200000}]}};
const chain={_id:"888888888888888888888888",container:"TEST",vendor,declared_milli_cft:200000,contribution_milli_cft:100000,stuffed_cft:200,complete:false,current_stage_id:"mill",stages:[{_id:"mill",kind:"sawmill",workflow_version:2,fields:{},documents:[],verified_at:null}],history:[],shipment_rows:[],excluded:[],unassigned:[],coverage:{allocated_cft:100,remaining_cft:100,verified_cft:0,complete:false}};
const requests=[],writes=[],errors=[];
const server=http.createServer((req,res)=>{let file=path.resolve(root,"."+decodeURIComponent(new URL(req.url,"http://localhost").pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||fs.statSync(file).isDirectory())file=path.join(root,"index.html");res.setHeader("Content-Type",({".html":"text/html",".js":"text/javascript",".css":"text/css",".svg":"image/svg+xml"})[path.extname(file)]||"application/octet-stream");fs.createReadStream(file).pipe(res);});
(async()=>{
  await new Promise(r=>server.listen(0,"127.0.0.1",r));const origin="http://127.0.0.1:"+server.address().port;
  const executablePath=process.env.PUPPETEER_EXECUTABLE_PATH||["Google/Chrome/Application/chrome.exe","Microsoft/Edge/Application/msedge.exe"].map(p=>path.join(process.env.PROGRAMFILES||"",p)).find(p=>fs.existsSync(p));
  const browser=await puppeteer.launch({headless:true,...(executablePath?{executablePath}:{})});
  try{
    const page=await browser.newPage();await page.setViewport({width:1440,height:1000});page.on("pageerror",e=>errors.push(e.message));
    const png=await require("sharp")({create:{width:400,height:500,channels:3,background:"#e4edf5"}}).png().toBuffer();
    await page.setRequestInterception(true);
    page.on("request",async request=>{
      const url=new URL(request.url());if(["blob:","data:"].includes(url.protocol))return request.continue();
      if(request.isNavigationRequest()&&url.origin===origin)return request.continue();
      const route=url.pathname.replace(/^\/api/,""),headers={"Access-Control-Allow-Origin":origin,"Access-Control-Allow-Credentials":"true","Access-Control-Allow-Headers":"content-type,range","Access-Control-Allow-Methods":"GET,POST,PUT,PATCH,OPTIONS","Cache-Control":"private, no-store"};
      const respond=(body,status=200)=>request.respond({status,contentType:"application/json",headers,body:JSON.stringify(body)});
      try{
        if(request.method()==="OPTIONS")return respond({});
        if(url.pathname.endsWith("/bootstrap.min.css")||url.pathname.endsWith("/bootstrap.bundle.min.js")){const css=url.pathname.endsWith(".css");return request.respond({status:200,contentType:css?"text/css":"text/javascript",body:fs.readFileSync(path.resolve(__dirname,"../../client/OMS/node_modules/bootstrap/dist/"+(css?"css/bootstrap.min.css":"js/bootstrap.bundle.min.js")))});}
        if(route.startsWith("/auth/"))return respond({user});
        if(route==="/permissions/me")return respond({role:user.role,permissions:{}});
        if(route.startsWith("/notifications"))return respond({data:[],unreadCount:0});
        if(route==="/eudr")return respond({data:[{...chain,declared_cft:200,contribution_cft:100}]});
        if(route==="/eudr/"+chain._id)return respond({data:chain});
        if(route==="/eudr/directory")return respond({data:[vendor,buyer].map(v=>({...v,fields:{gst:v.gst,pan:v.pan,sold_to:v.name}}))});
        if(route.startsWith("/eudr/inventory"))requests.push({route,query:Object.fromEntries(url.searchParams),method:request.method()});
        if(route==="/eudr/inventory/batches")return respond({data:url.searchParams.get("search")==="missing"?[]:lots,pagination:{page:1,pages:1,total:2}});
        if(route.startsWith("/eudr/inventory/batches/"))return respond({data:{...lots[0],network,audit:[]}});
        if(route==="/eudr/inventory/invoices")return respond({data:[invoice]});
        if(route==="/eudr/inventory/documents")return respond({data:[document]});
        if(route==="/eudr/inventory/documents/"+ids.D+"/content")return request.respond({status:200,contentType:"image/png",headers,body:png});
        if(route==="/eudr/inventory/documents/"+ids.D+"/url")return respond({url:origin+"/fixture-download"});
        if(route==="/eudr/inventory/reconcile")return respond({data:{feasible:true,status:"QUANTITY_FEASIBLE",ranges:[{...range,uncommitted_min_milli:200000,uncommitted_max_milli:200000}]}});
        if(route==="/eudr/inventory/transfers"&&request.method()==="POST"){const body=JSON.parse(request.postData());writes.push(body);return respond({code:"GLOBAL_QUANTITY_CONFLICT",message:"Proposed sale cannot fit shared source commitments",details:{lots:lots.map(l=>({id:l._id,documented_milli:l.quantity_milli})),transactions:[{id:ids.T,quantity_milli:600000,date:"2026-10-12"}]}},409);}
        if(route==="/eudr/inventory/commitments"){writes.push(JSON.parse(request.postData()));return respond({code:"GLOBAL_QUANTITY_CONFLICT",message:"Shared finished documentary capacity is exhausted"},409);}
        if(url.pathname.startsWith("/api/"))return respond({data:[]});
        if(url.origin!==origin)return request.abort();return request.continue();
      }catch(e){errors.push(e.message);return respond({message:e.message},500);}
    });
    const click=async(label,scope="")=>{await page.waitForFunction((label,scope)=>[...document.querySelectorAll(scope+" button")].some(b=>b.textContent.trim()===label&&!b.disabled),{},label,scope);await page.evaluate((label,scope)=>[...document.querySelectorAll(scope+" button")].find(b=>b.textContent.trim()===label&&!b.disabled).click(),label,scope);};
    await page.goto(origin+"/eudr",{waitUntil:"networkidle0"});await click("Inventory");await page.waitForSelector('[aria-label="Search inventory"]');
    assert.match(await page.$eval("main",e=>e.textContent),/0.000–200.000 CFT/);
    await page.type('[aria-label="Search inventory"]',"missing");await page.waitForFunction(()=>document.querySelector("main").textContent.includes("No matching documentary batches."));
    await page.click('[aria-label="Search inventory"]',{clickCount:3});await page.keyboard.press("Backspace");await page.waitForFunction(()=>[...document.querySelectorAll("button")].some(b=>b.textContent==="View batch"));
    const filtered=page.waitForResponse(r=>r.url().includes("/inventory/batches")&&new URL(r.url()).searchParams.get("mode")==="UNKNOWN");await page.select('[aria-label="Source allocation mode"]',"UNKNOWN");await filtered;assert.ok(requests.some(r=>r.query.mode==="UNKNOWN"));
    await click("View batch");await click("Upstream sources");await page.waitForSelector('svg[aria-label^="Documentary lots"]');assert.equal(await page.$$eval('svg[aria-label^="Documentary lots"] g[role="button"]',n=>n.length),3);
    await page.screenshot({path:path.join(output,"eudr-inventory-lineage.png")});
    await click("Documents");await page.waitForSelector(".eudr-document-card");assert.equal(await page.$$eval(".eudr-document-card",n=>n.length),1);
    await click("Preview");await page.waitForFunction(()=>document.querySelector(".eudr-image-document img")?.naturalWidth>0);await click("Close viewer");
    assert.equal(writes.length,0,"Reviewing shared evidence must not mutate verification");
    await click("Back to registry");await click("Mixed sale");
    await page.waitForSelector('[aria-label="Holder / seller"] option[value="'+vendor._id+'"]');
    await page.select('[aria-label="Holder / seller"]',vendor._id);await page.select('[aria-label="Buyer"]',buyer._id);
    await page.select('select:has(option[value="'+ids.I+'"])',ids.I);
    const fill=async(label,value)=>{await page.evaluate((label,value)=>{const el=[...document.querySelectorAll("label")].find(l=>l.querySelector(".form-label")?.textContent===label)?.querySelector("input");const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set;set.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));},label,value);};
    await fill("Documented sold / production CFT","300");await fill("Actual received CFT","300");
    await page.waitForSelector('fieldset input[type="checkbox"]');
    await page.evaluate(()=>[...document.querySelectorAll("fieldset")].find(f=>f.querySelector("legend")?.textContent==="Supporting documentary lots").querySelectorAll('input[type="checkbox"]').forEach(el=>el.click()));
    assert.equal(await page.$$eval('[aria-label^="Exact CFT"]',n=>n.length),0);
    await click("Check global quantity feasibility");await page.waitForFunction(()=>document.querySelector("main").textContent.includes("Combined uncommitted documentary capacity: 200.000 CFT"));
    await click("Save documentary draft");await page.waitForFunction(()=>document.querySelector('[role="alert"]')?.textContent.includes("GLOBAL_QUANTITY_CONFLICT"));
    assert.equal(writes.at(-1).mode,"UNKNOWN");assert.equal(writes.at(-1).inputs.length,2);assert.ok(writes.at(-1).inputs.every(i=>i.exact_cft==null));
    await page.setViewport({width:390,height:844});await page.screenshot({path:path.join(output,"eudr-inventory-mobile.png")});
    assert.equal(await page.$eval("body",e=>e.scrollWidth<=window.innerWidth),true);
    await page.setViewport({width:1440,height:1000});await page.goto(origin+"/eudr",{waitUntil:"networkidle0"});await click("Open");await click("Select vendor lots");await page.waitForFunction(()=>[...document.querySelectorAll("label .form-label")].some(e=>e.textContent==="Source contributions"));
    assert.ok(requests.some(r=>r.query.material==="FINISHED"));
    assert.deepEqual(errors,[]);
    console.log("EUDR inventory browser checks passed: registry ranges, search/filter, branching lineage, canonical preview, unknown inputs, conflict context, responsive form and container lot selection.");
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
