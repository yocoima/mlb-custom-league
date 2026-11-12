import {createRosterEditor,rowsToRoster,fillCommissionerSelect} from "./roster-editor.js";
import {recognizeRosterImage} from "./roster-import.js";
import {tournamentFormat} from "./tournament-format.js";

export function buildLeagueConfig({name,startDate,regulationInnings,rows,commissioner,format}){
  const leagueName=String(name||"").trim();
  if(!leagueName||leagueName.length>100)throw new Error("Indica un nombre de liga de hasta 100 caracteres.");
  if(["principal","torneo principal"].includes(leagueName.toLowerCase()))throw new Error("Elige un nombre propio para esta liga.");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)||Number.isNaN(Date.parse(startDate))||new Date(startDate).toISOString().slice(0,10)!==startDate)throw new Error("Indica la fecha de inicio de la liga.");
  const innings=Number(regulationInnings);
  if(!Number.isInteger(innings)||innings<1||innings>9)throw new Error("Elige entre 1 y 9 entradas reglamentarias.");
  const roster=rowsToRoster(rows),username=Object.keys(roster).find(name=>name.toLowerCase()===String(commissioner||"").toLowerCase());
  if(!username)throw new Error("Selecciona al comisionado entre los participantes.");
  const configuredFormat=tournamentFormat(format);
  if(configuredFormat&&configuredFormat.qualifierCount>rows.length)throw new Error("La cantidad de clasificados no puede superar la cantidad de participantes.");
  const value=roster[username];
  return {leagueName,startDate,regulationInnings:innings,username,myTeam:typeof value==="string"?value:value.team,roster,tournamentFormat:configuredFormat,platform:"psn"};
}

export function createLeagueSetup({dialog,onCreate}){
  const $=selector=>dialog.querySelector(selector);
  let step=0,busy=false,reading=false,controller=null,previewUrl="",generation=0;
  const editor=createRosterEditor($("#setupRoster"),{onChange:rows=>{fillCommissionerSelect($("#setupCommissioner"),rows);$("#setupParticipantCount").textContent=`${rows.length} participantes`;}});
  function error(message=""){$("#setupError").textContent=message;$("#setupError").classList.toggle("hidden",!message);}
  function showStep(next){
    step=next;error();
    dialog.querySelectorAll("[data-setup-step]").forEach(element=>element.classList.toggle("hidden",Number(element.dataset.setupStep)!==step));
    dialog.querySelectorAll("[data-step-label]").forEach(element=>{const active=Number(element.dataset.stepLabel)===step;element.classList.toggle("active",active);if(active)element.setAttribute("aria-current","step");else element.removeAttribute("aria-current");});
    $("#setupBack").disabled=step===0||busy||reading;
    $("#setupNext").classList.toggle("hidden",step===2);
    $("#setupDraft").classList.toggle("hidden",step!==2);$("#setupPublish").classList.toggle("hidden",step!==2);
    dialog.scrollTop=0;
  }
  function values(){
    return {name:$("#setupName").value,startDate:$("#setupStartDate").value,regulationInnings:$("#setupInnings").value,rows:editor.getRows(),commissioner:$("#setupCommissioner").value,format:$("#setupFormatEnabled").checked?{gamesPerOpponent:$("#setupGamesPerOpponent").value,qualifierCount:$("#setupQualifierCount").value,postseasonBestOf:$("#setupBestOf").value,finalBestOf:$("#setupFinalBestOf").value}:null};
  }
  function review(){
    const config=buildLeagueConfig(values()),summary=$("#setupReview");summary.replaceChildren();
    const add=(tag,text)=>{const element=document.createElement(tag);element.textContent=text;summary.append(element);};
    add("h3",config.leagueName);add("p",`Inicio: ${config.startDate} · ${config.regulationInnings} entradas`);
    add("p",`Comisionado: ${config.username} · ${config.myTeam}`);
    const format=config.tournamentFormat;
    add("p",format?`${format.gamesPerOpponent} juego(s) contra cada rival · ${format.qualifierCount} clasificados · Series al mejor de ${format.postseasonBestOf} · Final al mejor de ${format.finalBestOf}`:"Sin calendario automático; puedes configurar el formato después.");
    const list=document.createElement("ul");
    for(const row of editor.getRows()){const item=document.createElement("li");item.textContent=`${row.username.trim()} · ${row.team}`;list.append(item);}summary.append(list);
  }
  function setBusy(value){
    busy=value;dialog.querySelectorAll("button,input,select").forEach(element=>element.disabled=value);
    if(!value)showStep(step);
  }
  function cleanup(){generation++;controller?.abort();controller=null;reading=false;if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl="";$("#setupPhotoPreview").removeAttribute("src");$("#setupPhotoPreview").classList.add("hidden");$("#setupToken").value="";}
  function close(){if(busy)return;cleanup();dialog.close();}
  async function finish(publish){
    if(busy||reading)return;
    try{
      const config=buildLeagueConfig(values());
      if(!$("#setupReviewed").checked)throw new Error("Confirma que revisaste usuarios, equipos y comisionado.");
      const token=publish?$("#setupToken").value.trim():"";
      if(publish&&!token)throw new Error("Escribe la clave privada para crear y publicar, o guarda un borrador.");
      setBusy(true);error();await onCreate(config,{publish,token});
      busy=false;cleanup();dialog.close();
    }catch(cause){setBusy(false);error(cause.message);}
  }
  $("#setupNext").addEventListener("click",()=>{
    try{
      if(reading)return;
      if(step===0){
        for(const id of ["setupName","setupStartDate","setupInnings"])if(!$("#"+id).reportValidity())return;
        showStep(1);
      }else{review();showStep(2);}
    }catch(cause){error(cause.message);}
  });
  $("#setupBack").addEventListener("click",()=>showStep(Math.max(0,step-1)));
  $("#setupCancel").addEventListener("click",close);$("#setupClose").addEventListener("click",close);
  dialog.addEventListener("cancel",event=>{event.preventDefault();close();});
  $("#setupForm").addEventListener("submit",event=>{event.preventDefault();if(step===2)finish(true);else $("#setupNext").click();});
  $("#setupDraft").addEventListener("click",()=>finish(false));
  $("#setupAddParticipant").addEventListener("click",()=>{try{editor.add();}catch(cause){error(cause.message);}});
  $("#setupFormatEnabled").addEventListener("change",()=>$("#setupFormatFields").classList.toggle("hidden",!$("#setupFormatEnabled").checked));
  $("#setupPhoto").addEventListener("change",async()=>{
    const file=$("#setupPhoto").files[0];if(!file)return;
    if(editor.getRows().some(row=>row.username||row.team)&&!window.confirm("La foto agregará los participantes detectados a esta lista. Los usuarios que ya están no se reemplazan. ¿Continuar?"))return;
    const current=++generation;controller?.abort();const jobController=new AbortController();controller=jobController;reading=true;error();
    $("#setupNext").disabled=true;$("#setupBack").disabled=true;$("#setupPhoto").disabled=true;
    if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=URL.createObjectURL(file);$("#setupPhotoPreview").src=previewUrl;$("#setupPhotoPreview").classList.remove("hidden");
    const timeout=setTimeout(()=>jobController.abort(),90000);
    try{
      const result=await recognizeRosterImage(file,{signal:jobController.signal,onProgress:message=>{if(current===generation)$("#setupPhotoStatus").textContent=message;}});
      if(current!==generation)return;
      editor.merge(result.rows);
      if(!$("#setupCommissioner").value&&result.suggestedCommissioner)fillCommissionerSelect($("#setupCommissioner"),editor.getRows(),result.suggestedCommissioner);
      $("#setupPhotoStatus").textContent=result.rows.length?`Se detectaron ${result.rows.length} participantes. Revisa cada usuario y equipo, y confirma quién es el comisionado.${result.unread.length?` No se pudo leer el usuario de: ${result.unread.join(", ")}. Agrégalo manualmente.`:""}`:"No pudimos identificar participantes con suficiente claridad. Prueba una foto más nítida o agrégalos manualmente.";
    }catch(cause){if(current===generation)$("#setupPhotoStatus").textContent=cause.name==="AbortError"?"La lectura se canceló o tardó demasiado. Puedes probar otra foto o agregar participantes manualmente.":`No se pudo leer la foto: ${cause.message}`;}
    finally{clearTimeout(timeout);if(current===generation){reading=false;$("#setupNext").disabled=false;$("#setupBack").disabled=false;$("#setupPhoto").disabled=false;}}
  });
  return {open(){
    if(busy)return;cleanup();$("#setupForm").reset();setBusy(false);editor.setRows([]);$("#setupPhotoStatus").textContent="La foto se procesa en tu navegador. Revisa las lecturas antes de crear la liga.";$("#setupFormatFields").classList.remove("hidden");
    const now=new Date();$("#setupStartDate").value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
    showStep(0);dialog.showModal();$("#setupName").focus();
  }};
}
