import assert from 'node:assert/strict';
import https from 'node:https';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
const root=process.env.ADOPTION_ROOT;
const name=process.argv[2] ?? 'getStripePrices';
assert(root);
const requests=[];
const tlsRoot=mkdtempSync(join(tmpdir(),'autopatch-loopback-tls-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(tlsRoot,'key.pem'),'-out',join(tlsRoot,'cert.pem'),'-subj','/CN=localhost','-days','1'],{stdio:'ignore'});
const cert=readFileSync(join(tlsRoot,'cert.pem'));
const server=https.createServer({key:readFileSync(join(tlsRoot,'key.pem')),cert},(req,res)=>{
 requests.push({method:req.method,url:req.url,version:req.headers['stripe-version']});
 res.setHeader('content-type','application/json');
 res.end(JSON.stringify({object:'list',has_more:false,data:[
  {id:'price_monthly',product:{id:'prod_standard'},unit_amount:1200,currency:'usd',recurring:{interval:'month',trial_period_days:null}},
  {id:'price_yearly',product:'prod_standard',unit_amount:12000,currency:'usd',recurring:{interval:'year',trial_period_days:14}}
 ]}));
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port;
const original=https.request;
// Replace only Stripe's external HTTP destination. Real SDK serialization and
// the application's original helper execute unchanged against a loopback server.
https.request=(options,callback)=>{
 assert.equal(options.host ?? options.hostname,'api.stripe.com');
 const {agent,...rest}=options;
 return original({...rest,host:'127.0.0.1',hostname:'127.0.0.1',servername:'localhost',ca:cert,port},callback);
};
try {
 const module=await import(pathToFileURL(join(root,'lib/payments/stripe.ts')).href);
 const result=await module[name]();
 assert.deepEqual(result,[
  {id:'price_monthly',productId:'prod_standard',unitAmount:1200,currency:'usd',interval:'month',trialPeriodDays:null},
  {id:'price_yearly',productId:'prod_standard',unitAmount:12000,currency:'usd',interval:'year',trialPeriodDays:14}
 ]);
 assert.equal(requests.length,1);
 assert.equal(requests[0].method,'GET');
 assert.equal(requests[0].version,'2025-04-30.basil');
 const url=new URL(requests[0].url,'http://localhost');
 assert.equal(url.pathname,'/v1/prices');
 assert.deepEqual(Object.fromEntries(url.searchParams),{'expand[0]':'data.product',active:'true',type:'recurring'});
 console.log(JSON.stringify({name,requests,result}));
} finally {
 https.request=original;
 server.closeAllConnections();
 await new Promise(resolve=>server.close(resolve));
 rmSync(tlsRoot,{recursive:true,force:true});
}
