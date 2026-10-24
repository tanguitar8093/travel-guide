"""Search locally extracted OSM names with curated Chinese query aliases."""
import unicodedata

TRANSLATE = str.maketrans('國萬麗櫻邊濱嶽瀨廣壽樂龍龜臺灣廟', '国万丽樱辺浜岳瀬広寿楽竜亀台湾庙')

def normalize(text):
    return ''.join(c for c in unicodedata.normalize('NFKC',text).lower().translate(TRANSLATE) if c.isalnum())

# Aliases add search vocabulary, never fabricate coordinates or new OSM places.
ALIASES = [
    (['中本天婦羅','中本天麩羅','中本天ぷら','中本天妇罗','nakamoto tempura'], ['中本鮮魚','中本天ぷら','中本てんぷら','nakamoto']),
    (['波上宮','波上神宮','波の上宮','naminoue shrine'], ['波上宮','波の上宮','naminoue shrine','naminouegu']),
    (['美國村','美国村','american village'], ['アメリカンビレッジ','american village','美浜タウンリゾート']),
    (['美麗海','美丽海','churaumi'], ['美ら海','churaumi']),
    (['首里城','shuri castle'], ['首里城','shuri castle']),
    (['國際通','国际通','kokusai'], ['国際通','kokusai']),
    (['萬座毛','万座毛'], ['万座毛','cape manzamo']),
    (['古宇利島'], ['古宇利島','kouri island']),
    (['古宇利海灘'], ['古宇利ビーチ','kouri beach']),
    (['瀨長島','濑长岛'], ['瀬長島','senaga island']),
    (['瀨長島海灘'], ['瀬長ビーチ','senaga beach']),
    (['齋場御嶽','斋场御岳'], ['斎場御嶽','sefa utaki']),
    (['沖繩世界','沖繩世界文化王國','冲绳世界'], ['おきなわワールド','okinawa world']),
    (['玉泉洞'], ['玉泉洞','gyokusendo']),
    (['和平祈念公園','平和祈念公園'], ['平和祈念公園','peace memorial park']),
    (['姬百合之塔'], ['ひめゆりの塔','himeyuri monument']),
    (['姬百合和平祈念資料館'], ['ひめゆり平和祈念資料館','himeyuri peace museum']),
    (['殘波岬','残波岬'], ['残波岬','cape zanpa']),
    (['真榮田岬','真荣田岬'], ['真栄田岬','cape maeda']),
    (['名護鳳梨園','名护菠萝园'], ['ナゴパイナップルパーク','nago pineapple park']),
    (['名護自然動植物公園','新自然動植物公園'], ['ネオパークオキナワ','neo park okinawa']),
    (['陶藝之里','陶器之里'], ['やちむんの里','yachimun no sato']),
    (['壺屋陶器街','壺屋通'], ['壺屋やちむん通り','tsuboya yachimun']),
    (['識名園','识名园'], ['識名園','shikinaen']),
    (['海中道路'], ['海中道路','kaichu road']),
    (['勝連城跡','胜连城迹'], ['勝連城','katsuren castle']),
    (['座喜味城跡'], ['座喜味城','zakimi castle']),
    (['今歸仁城跡','今归仁城迹'], ['今帰仁城','nakijin castle']),
    (['中城城跡'], ['中城城','nakagusuku castle']),
    (['大石林山'], ['大石林山','daisekirinzan']),
    (['邊戶岬','边户岬'], ['辺戸岬','cape hedo']),
    (['Bios之丘','BIOS之丘'], ['ビオスの丘','bios hill','bios no oka']),
    (['東南植物樂園','东南植物乐园'], ['東南植物楽園','southeast botanical']),
    (['第一牧志公設市場','牧志公設市場'], ['第一牧志公設市場','makishi public market']),
    (['DMM水族館','DMM Kariyushi水族館'], ['dmmかりゆし水族館','dmm kariyushi aquarium']),
    (['Blue Seal冰淇淋','藍封冰淇淋'], ['ブルーシール','blue seal']),
    (['暖暮拉麵','暖暮拉面'], ['暖暮','danbo']),
    (['一蘭拉麵','一兰拉面'], ['一蘭','ichiran']),
    (['通堂拉麵','通堂拉面'], ['通堂','tondou']),
    (['傑克牛排館','杰克牛排馆'], ['ジャッキーステーキ','jack’s steak',"jack's steak"]),
    (['豬肉蛋飯糰','豬肉玉子飯糰'], ['ポークたまごおにぎり','pork tamago onigiri']),

]

class PlaceSearch:
    def __init__(self, data, dataset='okinawa'):
        self.dataset = dataset
        self.timestamp = data.get('dataTimestamp','unknown')
        self.entries=[]
        alias_rules=[(queries,[normalize(target) for target in targets]) for queries,targets in (ALIASES if dataset == 'okinawa' else [])]
        for original in data['places']:
            place=dict(original)
            names=[place['name'],place.get('english',''),*place.get('names',{}).values()]
            normalized=[normalize(name) for name in names if name]
            aliases=[]
            for queries,targets in alias_rules:
                chain = queries[0] in {'Blue Seal冰淇淋','暖暮拉麵','一蘭拉麵','通堂拉麵','傑克牛排館','豬肉蛋飯糰','中本天婦羅'}
                unrelated = place.get('category') in {'parking','hotel','restaurant','cafe','information','bicycle_rental','bus_stop','pharmacy','convenience','school','kindergarten'}
                relevant_chain = place.get('category') in {'restaurant','fast_food','cafe','ice_cream','food_court','bakery','confectionery','attraction'}
                if ((chain and relevant_chain) or (not chain and not unrelated)) and any(target in name for target in targets for name in normalized):
                    aliases.extend(queries)
            place['_primaryNames']=normalized
            place['aliases']=list(dict.fromkeys(aliases))
            place['aliasSource']='Curated Chinese search aliases matched to existing OSM names' if aliases else None
            self.entries.append((place,normalized+[normalize(alias) for alias in aliases]))

    def search(self, query):
        if not isinstance(query,str) or len(query)>100:
            raise ValueError('搜尋文字最多 100 個字。')
        term=normalize(query)
        suggestion=None
        if self.dataset == 'okinawa' and term==normalize('波上城'):
            term=normalize('波上宮')
            suggestion='你是否指「波上宮」？以下顯示波上宮相關地點。'
        if not term:
            return {'results':[],'total':0,'suggestion':None}
        ranked=[]
        for place,names in self.entries:
            matches=[name for name in names if term in name]
            if matches:
                score=min((0 if name==term else 1 if name.startswith(term) else 2,len(name)) for name in matches)
                if not any(term in name for name in place['_primaryNames']):
                    score=(score[0]+1,min(map(len,place['_primaryNames'])))
                ranked.append((score,place))
        ranked.sort(key=lambda item:(item[0],item[1]['name'],item[1]['id']))
        return {'results':[{k:v for k,v in place.items() if not k.startswith('_')} for _,place in ranked[:30]],'total':len(ranked),'suggestion':suggestion,'dataTimestamp':self.timestamp}
