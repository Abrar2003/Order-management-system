const test=require("node:test"),assert=require("node:assert/strict"),path=require("node:path");
const {spawnSync}=require("node:child_process");
const script=path.resolve(__dirname,"../scripts/eudrInventoryMigration.js");
test("migration CLI rejects missing and malformed URIs before connecting, without logging credentials",()=>{
  for(const [args,code] of [
    [["--uri","--mode","review-layer-dry-run"],"MONGODB_URI_REQUIRED"],
    [["--uri","","--mode","review-layer-dry-run"],"MONGODB_URI_REQUIRED"],
    [["--uri","https://operator:private-password@example.invalid/database","--mode","review-layer-dry-run"],"MONGODB_URI_INVALID"],
  ]){
    const result=spawnSync(process.execPath,[script,...args],{encoding:"utf8",timeout:10000,windowsHide:true});
    assert.ifError(result.error);assert.equal(result.status,1);assert.equal(result.stdout,"");
    assert.equal(JSON.parse(result.stderr.trim()).code,code);assert.ok(!result.stderr.includes("private-password"));
  }
});
