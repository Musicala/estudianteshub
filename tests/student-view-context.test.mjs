import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { studentViewContext } from '../src/student-view-context.js';

test('la vista de estudiante no hereda rol, controles ni perfiles administrativos',()=>{
 const student={id:'piano',instrumento:'Piano'};const user={uid:'admin-real'};
 const ctx=studentViewContext({user,studentId:'piano',student,isViewingAsStudent:true,isAdmin:true,isInternal:true,accessProfile:{role:'admin'},studentIds:['otro'],studentsById:new Map([['otro',{}]])});
 assert.equal(ctx.isAdmin,false);assert.equal(ctx.isInternal,false);assert.equal(ctx.accessProfile.role,'estudiante');assert.deepEqual(ctx.studentIds,['piano']);assert.equal(ctx.studentsById.size,1);assert.equal(ctx.student,student);assert.equal(ctx.user,user,'no suplanta la autenticación ni cambia la auditoría');
});
test('la sesión normal conserva intacto su contexto y sus permisos',()=>{
 const ctx={isAdmin:true,accessProfile:{role:'admin'}};assert.equal(studentViewContext(ctx),ctx);
});
test('la previsualización vuelve a leer solo la identidad seleccionada y no usa alias de la caché admin',async()=>{
 const source=fs.readFileSync(new URL('../src/app.js',import.meta.url),'utf8').replaceAll('\r','');
 const selection=source.slice(source.indexOf('async function setActiveStudent('),source.indexOf('/* =============================================================================\n  Selector de estudiante'));
 const calls=[];const ctx={state:{viewAsStudentId:'s1',studentIds:[],studentsById:new Map([['s1',{linkedStudentIds:['ajeno']} ]])},safeText:v=>String(v||''),isInternalUser:()=>true,persistActiveStudentId(){},setStudentLabel(){},clearGlobalMessages(){},api:{getStudentsByIds:async ids=>{calls.push(ids);return [{id:'s1'}];}},getStudentById:()=>{throw Error('no debe usar caché');}};
 vm.createContext(ctx);vm.runInContext(selection,ctx);await ctx.setActiveStudent('s1');assert.equal(JSON.stringify(calls),JSON.stringify([['s1']]));
 ctx.api.getStudentsByIds=async()=>[];await assert.rejects(ctx.setActiveStudent('s1'),/perfil actualizado/);
});
