'use strict';

// Plain-text books arrive in whatever encoding they were saved in: UTF-8,
// GBK/GB18030 (most Chinese web-novel TXT files), Big5 (traditional) or
// UTF-16 (Windows Notepad "Unicode"). Everything downstream — the reader, the
// search index and AI — works on the decoded text, so all of them go through
// decodeBookText().

const SAMPLE_BYTES = 64 * 1024;

// Very common characters in each script; whichever decoding produces more of
// them is the right one (Big5 bytes often also decode "validly" as GB18030).
const COMMON_SIMPLIFIED = new Set('的一是了不在人有我这他们中来上大为和到说时要就出会也你对能而子那得着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应向头文体相见被利什二等产或新己身果加西月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平气题活更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直资命山金指许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊怀执副乱抗犯追帮宣佛岁航优怪香著田铁控税左右份穿艺背阵草脚概恶块顿敢守酒岛托央户烈洋哥索胡款靠评版宝座释景顾弟登货互付伯慢欧换闻危忙核暗姐介坏讨丽良序升监临亮露永呼味野架域沙掉括舰鱼杂误湾吉减编楚肯测败屋跑梦散温困剑渐封救贵枪缺楼县尚毫移娘朋画班智亦耳恩短掌恐遗固席松秘谢鲁遇康虑幸均销钟诗藏赶剧票损忽巨炮旧端探湖录叶春乡附吸予礼港雨呀板庭妇归睛饭额含顺输摇招婚脱补谓督毒油疗旅泽材灭逐莫笔亡鲜词圣择寻厂睡博勒烟授诺伦岸奥唐卖俄炸载洛健堂旁宫喝借君禁阴园谋宋避抓荣姑孙逃牙束跳顶玉镇雪午练迫爷篇肉嘴馆遍凡础洞卷坦牛宁纸诸训私庄祖丝翻暴森塔默握戏隐熟骨访弱蒙歌店鬼软典欲萨伙遭盘爸扩盖弄雄稳忘亿刺拥徒姆杨齐赛趣曲刀床迎冰虚玩析窗醒妻透购替塞努休虎扬途侵刑绿兄迅套贸毕唯谷轮库迹尤竞街促延震弃甲伟麻川申缓潜闪售灯针哲络抵朱埃抱鼓植纯夏忍页杰筑折郑贝尊吴秀混臣雅振染盛怒舞圆搞狂措姓残秋培迷诚宽宇猛摆梅毁伸摩盟末乃悲拍丁赵硬麦蒋操耶阻订彩抽赞魔纷沿喊违妹浪汇币丰蓝殊献桌啦瓦莱援译夺汽烧距裁偏符勇触课敬哭懂墙袭召罚侠厅拜巧侧韩冒债曼融惯享戴童犹乘挂奖绍厚纵障讯涉彻刊丈爆乌役描洗玛患妙镜唱烦签仙彼弗症仿倾牌陷鸟轰咱菜闭奋庆撤泪茶疾缘播朗杜奶季丹狗尾仪偷奔珠虫驻孔宜艾桥淡翼恨繁寒伴叹旦愈潮粮缩罢聚径恰挑袋灰捕徐珍幕映裂泰隔启尖忠累炎暂估泛荒偿横拒瑞忆孤鼻闹羊呆厉衡胞零穷舍码赫婆魂灾洪腿胆津俗辩胸晓劲贫仁偶辑邦恢赖圈摸仰润堆碰艇稍迟辆废净凶署壁御奉旋冬矿抬蛋晨伏吹鸡倍糊秦盾杯租骑乏隆诊奴摄丧污渡旗甘耐凭扎抢绪粗肩梁幻菲皆碎宙叔岩荡综爬荷悉蒂返井壮薄悄扫敏碍殖详迪矛霍允幅撒剩凯颗骂赏液番箱贴漫酸郎腰舒眉忧浮辛恋餐吓挺励辞艘键伍峰尺昨黎辈贯侦滑券崇扰宪绕趋慈乔阅汗枝拖墨胁插箭腊粉泥氏彭拔骗凤慧媒佩愤扑龄驱惜豪掩兼跃尸肃帕驶堡届欣惠册储飘桑闲惨洁踪勃宾频仇磨递邪撞拟滚奏巡颜剂绩贡疯坡瞧截燃焦殿伪柳锁逼颇昏劝呈搜勤戒驾漂饮曹朵仔柔俩孟腐幼践籍牧凉牲佳娜浓芳稿竹腹跌逻垂遵脉貌柏狱猜怜惑陶兽帐饰贷昌叙躺钢沟寄扶铺邓寿惧询汤盗肥尝匆辉奈扣廷澳嘛董迁凝慰厌脏腾幽怨鞋丢埋泉涌辖躲晋紫艰魏吾慌祝邮吐狠鉴曰械咬邻赤挤弯椅陪割揭韦悟聪雾锋梯猫祥阔誉筹丛牵鸣沈阁穆屈旨袖猎臂蛇贺柱抛鼠瑟戈牢逊迈欺吨琴衰瓶恼燕仲诱狼池疼卢仗冠粒遥吕玄尘冯抚浅敦纠钻晶岂峡苍喷耗凌敲菌赔涂粹扁亏寂煤熊恭湿循暖糖赋抑秩帽哀宿踏烂袁侯抖夹昆肝擦猪炼恒慎搬纽纹玻渔磁铜齿跨押怖漠疲叛遣兹祭醉拳弥斜档稀捷肤疫肿豆削岗晃吞宏癌肚隶履涨耀扭坛拨沃绘伐堪仆郭牺歼墓雇廉契拼惩捉覆刷劫嫌瓜歇雕闷乳串娃缴唤赢莲霸桃妥瘦搭赴岳嘉舱俊址庞耕锐缝悔邀玲惟斥宅添挖呵讼氧浩羽斤酷掠妖祸侍乙妨贪挣汪尿莉悬唇翰仓轨枚盐览傅帅庙芬屏寺胖璃愚滴疏萧姿颤丑劣柯寸扔盯辱匹俱辨饿蜂哦腔郁溃谨糟葛苗肠忌溜鸿爵鹏鹰笼丘桂滋聊挡纲肌茨壳痕碗穴膀卓贤卧膜毅锦欠哩函茫昂薛皱夸豫胃舌剥傲拾窝睁携陵哼棉晴铃填饲渴吻扮逆脆喘罩卜炉柴愉绳胎蓄眠竭喂傻慕浑奸扇柜悦拦诞饱乾泡贼亭夕爹酬儒姻卵氛泄杆挨僧蜜吟猩遂狭肖甜霜揽搅坑佐竖棒缠碑兆炭');
const COMMON_TRADITIONAL = new Set('的一是了不在人有我這他們中來上大為和到說時要就出會也你對能而子那得著下自之年過發後作裡用道行所然家種事成方多經麼去法學如都同現當沒動面起看定天分還進好小部其些主樣理心她本前開但因只從想實日者意無力它與長把機十民第公此已工使情明性知全三又關點正業外將兩高間由問很最重並物手應向頭文體相見被利什二等產或新己身果加西月話合回特代內信表化老給世位次度門任常先海通教兒原東聲提立及比員解水名真論處走義各入幾口認條平氣題活更別打女變四神總何電數安少報才結反受目太量再感建務做接必場件計管期市直資命山金指許統區保至隊形社便空決治展馬科司五基眼書非則聽白卻界達光放強即像難且權思王象完設式色路記南品住告類求據程北邊死張該交規萬取拉格望覺術領共確傳師觀清今切院讓識候帶導爭運笑飛風步改收根乾造言聯持組每濟車親極林服快辦議往元英士證近失轉夫令準布始怎呢存未遠叫臺單影具羅字愛擊流備兵連調深商算質團集百需價花黨華城石級整府離況亞請技際約示復病息究線似官火斷精滿支視消越器容照須九增研寫稱企八功嗎包片史委乎查輕易早曾除農找裝廣顯吧阿李標談吃圖念六引歷首醫局突專費號盡另周較注語僅考落青隨選列武紅響雖推勢參希古眾構房半節土投某案黑維革劃敵致陳律足態護七興派孩驗責營星夠章音跟志底站嚴巴例防族供效續施留講型料終答緊黃絕奇察母京段依批群項故按河米圍江織害鬥雙境客紀採舉殺攻父蘇密低朝友訴止細願千值仍男錢破網熱助倒育屬坐帝限船臉職速刻樂否剛威毛狀率甚獨球般普怕彈校苦創假久錯承印晚蘭試股拿腦預誰益陽若哪微尼繼送急血驚傷素藥適波夜省初喜衛源食險待述陸習置居勞財環排福納歡雷警獲模充負雲停木遊龍樹疑層冷洲衝射略範竟句室異激漢村哈策演簡卡罪判擔州靜退既衣您宗積餘痛檢差富靈協角佔配徵修皮揮勝降階審沉堅善媽劉讀啊超免壓銀買皇養伊懷執副亂抗犯追幫宣佛歲航優怪香田鐵控稅左右份穿藝背陣草腳概惡塊頓敢守酒島託央戶烈洋哥索胡款靠評版寶座釋景顧弟登貨互付伯慢歐換聞危忙核暗姐介壞討麗良序升監臨亮露永呼味野架域沙掉括艦魚雜誤灣吉減編楚肯測敗屋跑夢散溫困劍漸封救貴槍缺樓縣尚毫移娘朋畫班智亦耳恩短掌恐遺固席松秘謝魯遇康慮幸均銷鐘詩藏趕劇票損忽巨炮舊端探湖錄葉春鄉附吸予禮港雨呀板庭婦歸睛飯額含順輸搖招婚脫補謂督毒油療旅澤材滅逐莫筆亡鮮詞聖擇尋廠睡博勒煙授諾倫岸奧唐賣俄炸載洛健堂旁宮喝借君禁陰園謀宋避抓榮姑孫逃牙束跳頂玉鎮雪午練迫爺篇肉嘴館遍凡礎洞卷坦牛寧紙諸訓私莊祖絲翻暴森塔默握戲隱熟骨訪弱蒙歌店鬼軟典欲薩伙遭盤爸擴蓋弄雄穩忘億刺擁徒姆楊齊賽趣曲刀床迎冰虛玩析窗醒妻透購替塞努休虎揚途侵刑綠兄迅套貿畢唯谷輪庫跡尤競街促延震棄甲偉麻川申緩潛閃售燈針哲絡抵朱埃抱鼓植純夏忍頁傑築折鄭貝尊吳秀混臣雅振染盛怒舞圓搞狂措姓殘秋培迷誠寬宇猛擺梅毀伸摩盟末乃悲拍丁趙硬麥蔣操耶阻訂彩抽贊魔紛沿喊違妹浪匯幣豐藍殊獻桌啦瓦萊援譯奪汽燒距裁偏符勇觸課敬哭懂牆襲召罰俠廳拜巧側韓冒債曼融慣享戴童猶乘掛獎紹厚縱障訊涉徹刊丈爆烏役描洗瑪患妙鏡唱煩簽仙彼弗症仿傾牌陷鳥轟咱菜閉奮慶撤淚茶疾緣播朗杜奶季丹狗尾儀偷奔珠蟲駐孔宜艾橋淡翼恨繁寒伴嘆旦愈潮糧縮罷聚徑恰挑袋灰捕徐珍幕映裂泰隔啟尖忠累炎暫估泛荒償橫拒瑞憶孤鼻鬧羊呆厲衡胞零窮舍碼赫婆魂災洪腿膽津俗辯胸曉勁貧仁偶輯邦恢賴圈摸仰潤堆碰艇稍遲輛廢淨兇署壁禦奉旋冬礦抬蛋晨伏吹雞倍糊秦盾杯租騎乏隆診奴攝喪汙渡旗甘耐憑紮搶緒粗肩梁幻菲皆碎宙叔岩蕩綜爬荷悉蒂返井壯薄悄掃敏礙殖詳迪矛霍允幅撒剩凱顆罵賞液番箱貼漫酸郎腰舒眉憂浮辛戀餐嚇挺勵辭艘鍵伍峰尺昨黎輩貫偵滑券崇擾憲繞趨慈喬閱汗枝拖墨脅插箭臘粉泥氏彭拔騙鳳慧媒佩憤撲齡驅惜豪掩兼躍屍肅帕駛堡屆欣惠冊儲飄桑閒慘潔蹤勃賓頻仇磨遞邪撞擬滾奏巡顏劑績貢瘋坡瞧截燃焦殿偽柳鎖逼頗昏勸呈搜勤戒駕漂飲曹朵仔柔倆孟腐幼踐籍牧涼牲佳娜濃芳稿竹腹跌邏垂遵脈貌柏獄猜憐惑陶獸帳飾貸昌敘躺鋼溝寄扶鋪鄧壽懼詢湯盜肥嘗匆輝奈扣廷澳嘛董遷凝慰厭髒騰幽怨鞋丟埋泉湧轄躲晉紫艱魏吾慌祝郵吐狠鑑曰械咬鄰赤擠彎椅陪割揭韋悟聰霧鋒梯貓祥闊譽籌叢牽鳴沈閣穆屈旨袖獵臂蛇賀柱拋鼠瑟戈牢遜邁欺噸琴衰瓶惱燕仲誘狼池疼盧仗冠粒遙呂玄塵馮撫淺敦糾鑽晶豈峽蒼噴耗凌敲菌賠塗粹扁虧寂煤熊恭濕循暖糖賦抑秩帽哀宿踏爛袁侯抖夾昆肝擦豬煉恆慎搬紐紋玻漁磁銅齒跨押怖漠疲叛遣茲祭醉拳彌斜檔稀捷膚疫腫豆削崗晃吞宏癌肚隸履漲耀扭壇撥沃繪伐堪僕郭犧殲墓僱廉契拼懲捉覆刷劫嫌瓜歇雕悶乳串娃繳喚贏蓮霸桃妥瘦搭赴嶽嘉艙俊址龐耕銳縫悔邀玲惟斥宅添挖呵訟氧浩羽斤酷掠妖禍侍乙妨貪掙汪尿莉懸唇翰倉軌枚鹽覽傅帥廟芬屏寺胖璃愚滴疏蕭姿顫醜劣柯寸扔盯辱匹俱辨餓蜂哦腔鬱潰謹糟葛苗腸忌溜鴻爵鵬鷹籠丘桂滋聊擋綱肌茨殼痕碗穴膀卓賢臥膜毅錦欠哩函茫昂薛皺誇豫胃舌剝傲拾窩睜攜陵哼棉晴鈴填飼渴吻扮逆脆喘罩卜爐柴愉繩胎蓄眠竭餵傻慕渾奸扇櫃悅攔誕飽乾泡賊亭夕爹酬儒姻卵氛洩桿挨僧蜜吟猩遂狹肖甜霜攬攪坑佐豎棒纏碑兆炭');

function decoderFor(encoding, fatal) {
  try {
    return new TextDecoder(encoding, { fatal });
  } catch {
    return null;
  }
}

function tryDecode(bytes, encoding) {
  const decoder = decoderFor(encoding, true);
  if (!decoder) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

// The sample may end in the middle of a multi-byte character; trim the
// partial tail so a strict decode does not fail on it.
function sampleOf(bytes) {
  return bytes.length <= SAMPLE_BYTES ? bytes : bytes.subarray(0, SAMPLE_BYTES);
}

function commonCharacterScore(text, common) {
  let score = 0;
  for (const character of text) if (common.has(character)) score += 1;
  return score;
}

function utf16WithoutBom(sample) {
  const length = Math.min(sample.length - (sample.length % 2), 4096);
  if (length < 64) return null;
  let evenZeros = 0;
  let oddZeros = 0;
  for (let index = 0; index < length; index += 2) {
    if (sample[index] === 0) evenZeros += 1;
    if (sample[index + 1] === 0) oddZeros += 1;
  }
  const pairs = length / 2;
  // Latin text in UTF-16 has a zero in every other byte; CJK text has few,
  // so only clear cases are taken.
  if (oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return 'utf-16le';
  if (evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return 'utf-16be';
  return null;
}

function detectTextEncoding(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return { encoding: 'utf-8', bom: 3 };
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return { encoding: 'utf-16le', bom: 2 };
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return { encoding: 'utf-16be', bom: 2 };
  const sample = sampleOf(bytes);
  // Before UTF-8: UTF-16 Latin text is full of NUL bytes, which UTF-8 accepts.
  const utf16 = utf16WithoutBom(sample);
  if (utf16) return { encoding: utf16, bom: 0 };
  // A UTF-8 sample may be cut inside a character: allow up to 3 trailing bytes.
  for (let trim = 0; trim <= Math.min(3, sample.length); trim += 1) {
    if (trim > 0 && sample.length === bytes.length) break;
    if (tryDecode(sample.subarray(0, sample.length - trim), 'utf-8') !== null) return { encoding: 'utf-8', bom: 0 };
  }
  const candidates = [];
  for (const [encoding, common] of [['gb18030', COMMON_SIMPLIFIED], ['big5', COMMON_TRADITIONAL]]) {
    for (let trim = 0; trim <= 1; trim += 1) {
      const text = tryDecode(sample.subarray(0, sample.length - trim), encoding);
      if (text !== null) {
        candidates.push({ encoding, score: commonCharacterScore(text, common) });
        break;
      }
    }
  }
  candidates.sort((left, right) => right.score - left.score);
  if (candidates.length) return { encoding: candidates[0].encoding, bom: 0 };
  return { encoding: null, bom: 0 };
}

// Decoded text plus the encoding it was read as. `encoding` is null when the
// file is not cleanly text in any supported encoding (binary or damaged); the
// text is then a lossy reading so the reader still shows something.
function decodeBookText(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input || []);
  const { encoding, bom } = detectTextEncoding(bytes);
  const body = bom ? bytes.subarray(bom) : bytes;
  if (encoding) {
    const text = tryDecode(body, encoding);
    if (text !== null) return { text, encoding };
    const lossy = decoderFor(encoding, false);
    if (lossy) return { text: lossy.decode(body), encoding: null };
  }
  return { text: new TextDecoder('utf-8', { fatal: false }).decode(body), encoding: null };
}

module.exports = { decodeBookText, detectTextEncoding };
