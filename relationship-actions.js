(function(global){
 'use strict';
 const id=v=>{const s=String(v??'');if(!/^[1-9]\d*$/.test(s))throw new Error('Invalid customer or department identifier. Refresh and select the relationship again.');return s;};
 async function find(client,customerId,departmentId){const r=await client.from('department_customer_companies').select('id,department_id,customer_company_id').eq('customer_company_id',customerId).eq('department_id',departmentId).limit(2);if(r.error)throw r.error;return r.data||[];}
 async function unlink(client,customer,department){
  const customerId=id(customer),departmentId=id(department),before=await find(client,customerId,departmentId);
  if(!before.length)return {alreadyAbsent:true,removed:false};
  const response=await client.rpc('unlink_customer_from_department',{p_customer_company_id:customerId,p_department_id:departmentId});
  if(response.error&&!/relationship not found/i.test(response.error.message||''))throw response.error;
  const after=await find(client,customerId,departmentId);
  if(!after.length)return {alreadyAbsent:false,removed:true};
  if(response.error)throw new Error('The relationship still exists. Refresh the page and select it again. No relationship was removed.');
  throw new Error('The relationship was not removed. Check your access or linked purchase orders.');
 }
 global.PERelationships={unlink};
})(window);

