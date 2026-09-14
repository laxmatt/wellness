import { CategoryDefinition } from "../category";

// Staging definition. Keep out of public navigation until the first reviewed
// batch is ready. Setup score measures installation convenience, not health.
export const saunas = CategoryDefinition.parse({
  id: "saunas", slug: "saunas", name: "Saunas", navLabel: "Saunas",
  tagline: "Compare saunas by space, heat type and installation needs.",
  intro: "Start with your space, budget and electrical setup. Compare the published specifications and check installation requirements with the merchant before buying.",
  subcategories: [{id:"infrared",label:"Infrared"},{id:"traditional",label:"Traditional"}],
  attributeDefinitions: [
    {key:"heat_type",label:"Heat type",type:"enum",enumOptions:[{value:"infrared",label:"Far infrared"},{value:"traditional",label:"Traditional"}],group:"Type",compareOrder:1,required:true},
    {key:"capacity",label:"Seating capacity",type:"string",group:"Space",compareOrder:2,required:true},
    {key:"width_in",label:"Exterior width",type:"number",unit:"in",group:"Space",compareOrder:3},
    {key:"depth_in",label:"Exterior depth",type:"number",unit:"in",group:"Space",compareOrder:4},
    {key:"height_in",label:"Exterior height",type:"number",unit:"in",group:"Space",compareOrder:5},
    {key:"placement",label:"Placement",type:"list",group:"Setup",compareOrder:6},
    {key:"connection",label:"Electrical connection",type:"enum",enumOptions:[{value:"plug_in",label:"Plug-in",rank:1},{value:"hardwired",label:"Hardwired",rank:2}],group:"Setup",compareOrder:7,required:true,preferenceDirection:"lower_better"},
    {key:"voltage",label:"Voltage",type:"number",unit:"V",group:"Setup",compareOrder:8},
    {key:"circuit_amps",label:"Circuit requirement",type:"number",unit:"A",group:"Setup",compareOrder:9}
  ],
  cardSpecKeys:["heat_type","capacity","connection"],
  compareGroups:[{label:"Type and space",keys:["heat_type","capacity","width_in","depth_in","height_in"]},{label:"Installation",keys:["placement","connection","voltage","circuit_amps"]}],
  filters:[{key:"price",label:"Price",kind:"range",presets:[{label:"Under $5,000",condition:{key:"price",op:"lt",value:500000}}]},{key:"heat_type",label:"Heat type",kind:"enum"},{key:"placement",label:"Placement",kind:"list"},{key:"connection",label:"Electrical connection",kind:"enum"}],
  scoring:{criteria:[{key:"connection",weight:1}],label:"Setup simplicity",meaning:"Rewards a plug-in connection over hardwiring. It does not measure build quality, health benefits or personal fit.",completenessFloor:1},
  value:{qualityWeight:0,affordabilityWeight:1,priceBasis:"price"},
  badges:{budgetMaxMinor:500000,premiumMinMinor:1000000,minQualifying:100,tieBreak:[]},
  insightRules:[],relaxationOrder:["price","placement","connection","heat_type"],
  priceTiers:[{id:"entry",label:"Under $5,000",maxMinor:500000},{id:"higher",label:"$5,000 and up"}],facets:[],aliases:["sauna","saunas"]
});
