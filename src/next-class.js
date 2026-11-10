'use strict';
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const date=value=>new Intl.DateTimeFormat('es-CO',{timeZone:'America/Bogota',weekday:'long',day:'numeric',month:'long',hour:'numeric',minute:'2-digit'}).format(new Date(value));
export function renderNextClass(result,changed=false){
 const next=result?.classes?.[0];
 if(!next)return '<p>No hay clases vinculadas para los próximos 45 días. Si tienes una reserva reciente, consulta a coordinación para confirmar su vínculo.</p>';
 return `<p><strong>${next.inProgress?'Tu clase está en curso':'Próxima clase'} · ${escape(date(next.start))}</strong></p><h3>${escape(next.serviceName)}</h3><p>Docente: ${escape(next.teacherName)}</p><p><strong>${escape(next.roomName)}</strong>${next.location?` · ${escape(next.location)}`:''}</p>${changed?'<p role="status">El salón cambió. Revisa la asignación actual antes de llegar.</p>':''}${!next.roomConfirmed?`<p>${next.roomConflict?'Coordinación está revisando la asignación del salón.':'El salón todavía está por confirmar.'}</p>`:''}${['pending','pendiente'].includes(String(next.status).toLowerCase())?'<p>La reserva está pendiente de confirmación.</p>':''}<small>Horario de Bogotá.</small>`;
}
export function mountNextClass(panel,{studentId,userId,callFunction,storage=globalThis.sessionStorage}={}){
 if(!panel||!studentId)return;
 let busy=false,lastRoom=null,timer;
 const button=panel.querySelector('[data-next-refresh]'),body=panel.querySelector('[data-next-body]');
 const current=()=>panel.isConnected&&panel.dataset.nextStudent===String(studentId);
 async function refresh(){
  if(!current()||busy)return;busy=true;if(button)button.disabled=true;
  try{
   const result=await callFunction('getStudentUpcomingClasses',{studentId},{timeout:60000});
   if(!current())return;
   if(result?.studentId!==studentId||!Array.isArray(result.classes))throw Error('No se pudo verificar la agenda seleccionada.');
   const next=result.classes[0],key=next?`musicala.next-room.${userId||'session'}.${studentId}.${next.bookingId}`:'';
   let previous=lastRoom;
   try{if(key&&previous?.bookingId!==next.bookingId){const saved=storage?.getItem(key);previous=saved?{bookingId:next.bookingId,roomName:saved}:null;}}catch{}
   const changed=Boolean(next?.roomConfirmed&&previous?.bookingId===next.bookingId&&previous.roomName!==next.roomName);
   body.innerHTML=renderNextClass(result,changed);
   if(next?.roomConfirmed){lastRoom={bookingId:next.bookingId,roomName:next.roomName};try{storage?.setItem(key,next.roomName);}catch{}}
  }catch(error){if(current())body.innerHTML='<p role="status">No pudimos verificar tu próxima clase. Pulsa Actualizar para intentarlo nuevamente o consulta a coordinación.</p>';}
  finally{busy=false;if(current()&&button)button.disabled=false;}
 }
 if(button)button.onclick=()=>refresh();
 function tick(){if(!current())return;if(globalThis.document?.visibilityState!=='hidden')void refresh();timer=setTimeout(tick,60000);}
 void refresh();timer=setTimeout(tick,60000);
 return ()=>clearTimeout(timer);
}
