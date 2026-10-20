const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const net = require("node:net");
const { spawn } = require("node:child_process");
const mongoose = require("mongoose");
module.exports = async function replicaSet(executable = process.env.EUDR_TEST_MONGOD || "mongod") {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "oms-eudr-ledger-test-"));
  const listener = net.createServer();
  await new Promise(resolve=>listener.listen(0,"127.0.0.1",resolve)); const port=listener.address().port;
  await new Promise(resolve=>listener.close(resolve));
  const processHandle=spawn(executable,["--dbpath",directory,"--port",String(port),"--bind_ip","127.0.0.1","--replSet","ledger-test","--logpath",path.join(directory,"mongod.log")],{windowsHide:true,stdio:"ignore"});
  let spawnError;processHandle.on("error",e=>spawnError=e);
  const bootstrap=new mongoose.mongo.MongoClient("mongodb://127.0.0.1:"+port+"/?directConnection=true",{serverSelectionTimeoutMS:500});
  const close=async()=>{
    await mongoose.disconnect();await bootstrap.close();
    if(processHandle.exitCode==null&&!spawnError){const exit=new Promise(resolve=>processHandle.once("exit",resolve));processHandle.kill();await exit;}
    assert.equal(path.dirname(directory),os.tmpdir());assert.ok(path.basename(directory).startsWith("oms-eudr-ledger-test-"));
    await fs.rm(directory,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  };
  try{
    const deadline=Date.now()+30000;
    for(;;){if(spawnError)throw spawnError;if(processHandle.exitCode!=null)throw new Error("Test mongod exited");try{await bootstrap.connect();break;}catch(e){if(Date.now()>deadline)throw e;await new Promise(r=>setTimeout(r,150));}}
    const admin=bootstrap.db("admin");assert.equal((await admin.command({serverStatus:1})).pid,processHandle.pid);
    await admin.command({replSetInitiate:{_id:"ledger-test",members:[{_id:0,host:"127.0.0.1:"+port}]}});
    while(!(await admin.command({hello:1})).isWritablePrimary){if(Date.now()>deadline)throw new Error("Test replica set election failed");await new Promise(r=>setTimeout(r,150));}
    mongoose.set("transactionAsyncLocalStorage",true);
    await mongoose.connect("mongodb://127.0.0.1:"+port+"/eudr_ledger_test?replicaSet=ledger-test",{autoIndex:false,autoCreate:false});
    mongoose.connection.$supportsTransactions=true;return {close};
  }catch(e){await close();throw e;}
};
