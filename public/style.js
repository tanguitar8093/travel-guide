export function createStyle(dark=false){
  const c=dark?{water:'#193e49',land:'#293f39',road:'#718479',main:'#c6ac76',coast:'#567c79'}:{water:'#bcdde1',land:'#f3f1e7',road:'#fffdf9',main:'#e4bb7a',coast:'#87b8b8'};
  return {version:8,sources:{land:{type:'geojson',data:'/data/land.geojson',attribution:'<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors · ODbL</a>'},water:{type:'geojson',data:'/data/water.geojson'},roads:{type:'geojson',data:'/data/roads.geojson'}},layers:[
    {id:'sea',type:'background',paint:{'background-color':c.water}},
    {id:'land',type:'fill',source:'land',paint:{'fill-color':c.land}},
    {id:'coast',type:'line',source:'land',paint:{'line-color':c.coast,'line-width':1}},
    {id:'water',type:'fill',source:'water',paint:{'fill-color':c.water}},
    {id:'roads',type:'line',source:'roads',minzoom:10,paint:{'line-color':c.road,'line-width':['interpolate',['linear'],['zoom'],10,0.4,14,2,17,7]}},
    {id:'main-roads',type:'line',source:'roads',filter:['in',['get','class'],['literal',['motorway','trunk','primary','secondary']]],paint:{'line-color':c.main,'line-width':['interpolate',['linear'],['zoom'],8,0.6,12,2,17,9]}},
  ]};
}
