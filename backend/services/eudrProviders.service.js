const {fail}=require("../helpers/timberSpecies");
const simulated=()=>process.env.NODE_ENV!=="production"&&process.env.EUDR_PROVIDER_MODE!=="off";
function gstinValid(g) {
  if(!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[A-Z\d]$/.test(g))return false;
  const chars="0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";let sum=0;
  for(let i=0;i<14;i++){const p=chars.indexOf(g[i])*(i%2?2:1);sum+=Math.floor(p/36)+p%36;}
  return chars[(36-sum%36)%36]===g[14];
}
const result=(value,provider)=>({...value,provider,simulated:simulated(),checked_at:new Date()});
const GstLookupService={async lookup(gstin){if(!gstinValid(gstin))throw fail("GSTIN_INVALID","GSTIN format or check digit is invalid");const registry={"08AAJFM6604Q1ZO":{status:"Active",legal_name:"Mahaveer Timber Mart",address:"Basni Industrial Area, Jodhpur, Rajasthan",registration_date:"2017-07-01",type:"Partnership firm"},"08AABFK1190E1ZO":{status:"Cancelled",legal_name:"Kanha Timbers",address:"Pali Road, Jodhpur, Rajasthan",registration_date:"2018-03-14",type:"Partnership firm"}};return result(simulated()?(registry[gstin]||{status:null,result:"Not checked"}):{status:null,result:"Not checked"},simulated()?"Simulated GST registry":"Unconfigured GST provider");}};
const EwayBillVerificationService={async verify(number){return result({result:simulated()&&number?(/^38100\d{7}$/.test(number)?"Verified":"Not found"):"Not checked"},simulated()?"Simulated e-way bill":"Unconfigured e-way bill provider");}};
const EInvoiceVerificationService={async verify(irn){return result({result:simulated()&&irn?(/^INVALID/i.test(irn)?"Invalid":"Valid"):"Not checked"},simulated()?"Simulated e-invoice":"Unconfigured e-invoice provider");}};
const SatelliteCheckService={async check(plot){const seed=[...String(plot._id)].reduce((a,c)=>a+c.charCodeAt(0),0);const state=["Pass","Review","Fail"][seed%3];return result(simulated()?{result:state,forest_2020:state==="Pass"?"Not forest (simulated)":state==="Review"?"Partly forest (simulated)":"Forest (simulated)",loss_ha:state==="Pass"?0:Math.round(plot.area_ha*(state==="Fail"?0.6:0.1)*10)/10,tiles:[]}: {result:"Pending",forest_2020:"Not checked",loss_ha:null,tiles:[]},simulated()?"Simulated satellite":"Unconfigured satellite provider");}};
const DocumentExtractionService={async extract(){return {result:"Not checked",provider:"Disabled",values:[]};}};
function plotData(body) {
  let coords=body.coords;
  if(typeof coords==="string")coords=coords.trim().split(/\r?\n/).map(line=>line.split(",").map(v=>v.trim()===""?NaN:Number(v.trim())));
  if(!Array.isArray(coords)||coords.length>1000||!(coords.length===1||coords.length>=3)||coords.some(c=>!Array.isArray(c)||c.length!==2||!c.every(Number.isFinite)||Math.abs(c[0])>90||Math.abs(c[1])>180))throw fail("PLOT_COORDINATES_INVALID","Provide one point or at least three valid latitude, longitude pairs");
  let area;
  if(coords.length===1){area=Number(body.declared_area_ha);if(!Number.isFinite(area)||area<=0)throw fail("PLOT_AREA_REQUIRED","A point requires a positive declared area");}
  else {const [lat,lng]=coords[0],cos=Math.cos(lat*Math.PI/180),points=coords.map(c=>[(c[1]-lng)*cos*111320,(c[0]-lat)*110574]);let twice=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];twice+=a[0]*b[1]-b[0]*a[1];}area=Math.round(Math.abs(twice)/2/10000*10)/10;if(area<=0)throw fail("PLOT_COORDINATES_INVALID","Polygon must enclose a non-zero area");}
  return {coords,area_ha:area,declared_area_ha:body.declared_area_ha==null?undefined:Number(body.declared_area_ha)};
}
module.exports={gstinValid,plotData,GstLookupService,EwayBillVerificationService,EInvoiceVerificationService,SatelliteCheckService,DocumentExtractionService};
