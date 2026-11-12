export const MLB_TEAMS=["Diamondbacks","Braves","Orioles","Red Sox","Cubs","White Sox","Reds","Guardians","Rockies","Tigers","Astros","Royals","Angels","Dodgers","Marlins","Brewers","Twins","Mets","Yankees","Athletics","Phillies","Pirates","Padres","Giants","Mariners","Cardinals","Rays","Rangers","Blue Jays","Nationals"].sort();
const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
export function rosterToRows(roster={}){
  if(!roster||typeof roster!=="object"||Array.isArray(roster))throw new Error("La lista de participantes no es válida.");
  return Object.entries(roster).map(([username,value])=>typeof value==="string"?{username,team:value}:{username:value?.username||username,team:value?.team||value?.teamName||"",extra:{...value}});
}
export function rowsToRoster(rows){
  if(rows.length<2)throw new Error("Agrega al menos dos participantes.");
  if(rows.length>100)throw new Error("La liga admite hasta 100 participantes.");
  const seen=new Set(),entries=[];
  for(const [index,row] of rows.entries()){
    const username=String(row.username||"").trim(),team=String(row.team||"").trim();
    if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,79}$/.test(username))throw new Error(`Revisa el usuario del participante ${index+1}: usa su ID de PSN, sin espacios.`);
    if(["__proto__","constructor","prototype"].includes(username.toLowerCase()))throw new Error("Ese nombre de usuario no es válido.");
    if(!team)throw new Error(`Selecciona el equipo de ${username}.`);
    if(seen.has(username.toLowerCase()))throw new Error(`El usuario ${username} está repetido.`);
    seen.add(username.toLowerCase());
    const value=row.extra?{...row.extra,username,team}:team;
    entries.push([username,value]);
  }
  return Object.fromEntries(entries);
}

export function createRosterEditor(container,{onChange=()=>{}}={}){
  let rows=[];
  const notify=()=>onChange(rows.map(row=>({...row})));
  function render(){
    container.innerHTML=rows.length?rows.map((row,index)=>{
      const teams=MLB_TEAMS.includes(row.team)||!row.team?MLB_TEAMS:[row.team,...MLB_TEAMS];
      return `<div class="roster-row" data-row="${index}"><label>Usuario PSN<input data-field="username" value="${esc(row.username)}" autocomplete="off" spellcheck="false" maxlength="80" aria-label="Usuario del participante ${index+1}" /></label><label>Equipo MLB<select data-field="team" aria-label="Equipo del participante ${index+1}"><option value="">Seleccionar equipo</option>${teams.map(team=>`<option${team===row.team?" selected":""}>${esc(team)}</option>`).join("")}</select></label><button type="button" class="btn roster-remove" data-remove="${index}" aria-label="Quitar participante ${index+1}">Quitar</button>${row.imported?'<small class="roster-review">Leído de la foto: revisa usuario y equipo.</small>':""}</div>`;
    }).join(""):'<p class="empty">Agrega participantes o importa una foto de la pantalla del juego.</p>';
  }
  container.addEventListener("input",event=>{
    const index=Number(event.target.closest("[data-row]")?.dataset.row),field=event.target.dataset.field;
    if(!field||!rows[index])return;
    rows[index][field]=event.target.value;notify();
  });
  container.addEventListener("change",event=>{
    if(event.target.dataset.field!=="team")return;
    const index=Number(event.target.closest("[data-row]").dataset.row);rows[index].team=event.target.value;notify();
  });
  container.addEventListener("click",event=>{
    const button=event.target.closest("[data-remove]");if(!button)return;
    rows.splice(Number(button.dataset.remove),1);render();notify();
  });
  return {
    setRows(next){rows=next.map(row=>({...row}));render();notify();},
    getRows(){return rows.map(row=>({...row}));},
    add(row={username:"",team:""}){if(rows.length>=100)throw new Error("Máximo 100 participantes.");rows.push({...row});render();notify();container.querySelector(".roster-row:last-child input")?.focus();},
    merge(next){
      rows=rows.filter(row=>row.username.trim()||row.team);
      for(const row of next){const existing=rows.find(item=>item.username.trim().toLowerCase()===row.username.trim().toLowerCase());if(!existing)rows.push({...row});}
      render();notify();
    }
  };
}

export function fillCommissionerSelect(select,rows,preferred=select.value){
  const names=rows.map(row=>row.username.trim()).filter(Boolean);
  select.innerHTML='<option value="">Seleccionar comisionado</option>'+[...new Set(names)].map(name=>`<option value="${esc(name)}">${esc(name)}</option>`).join("");
  select.value=names.find(name=>name.toLowerCase()===String(preferred||"").toLowerCase())||"";
}
