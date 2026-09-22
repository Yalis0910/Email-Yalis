"""
Trade Terms & Cross-Lingual Query Expansion for Foreign Trade Emails.
Maps common Chinese trade terminology to English trade keywords, enabling
bilingual retrieval in FTS5 and LIKE queries without heavy model dependencies.
"""

import re
from typing import List, Union, Set

FOREIGN_TRADE_TERMS = {
    # 样品与模具
    "打样": ["sample", "sampling", "prototyping", "mold", "mockup"],
    "样品": ["sample", "prototype", "swatch", "specimen"],
    "样品费": ["sample fee", "sample charge", "sampling cost"],
    "模具": ["mold", "mould", "tooling", "die", "molding"],
    "模具费": ["mold fee", "mould charge", "tooling cost"],
    "版费": ["setup fee", "mold charge", "artwork fee"],
    "打样时间": ["sample lead time", "sampling time"],

    # 报价与价格
    "报价": ["quote", "quotation", "price", "offer", "estimate"],
    "单价": ["unit price", "price per piece", "piece price", "each"],
    "价格": ["price", "cost", "quote", "rate"],
    "费用": ["fee", "cost", "charge", "expense"],
    "还价": ["counter offer", "counter-offer", "lower the price", "target price"],
    "降价": ["discount", "price reduction", "lower price", "cheaper"],
    "折扣": ["discount", "rebate", "special offer", "deduction"],
    "目标价": ["target price", "budget"],

    # 订单与条款
    "订单": ["order", "purchase order", "po", "p.o."],
    "采购单": ["purchase order", "po", "order sheet"],
    "合同": ["contract", "agreement", "proforma invoice", "terms"],
    "形式发票": ["proforma invoice", "pi", "p/i"],
    "发票": ["invoice", "commercial invoice", "ci", "receipt"],
    "装箱单": ["packing list", "pl"],

    # 付款与财务
    "付款": ["payment", "wire transfer", "tt", "t/t", "remittance", "paid"],
    "定金": ["deposit", "down payment", "advance payment"],
    "首付款": ["deposit", "down payment", "initial payment"],
    "尾款": ["balance", "balance payment", "final payment", "remaining"],
    "全款": ["full payment", "100% payment"],
    "转账": ["wire transfer", "bank transfer", "tt", "remittance"],
    "退款": ["refund", "reimbursement", "credit note"],
    "水单": ["bank slip", "transfer receipt", "payment proof", "swift"],
    "账期": ["payment terms", "net 30", "net 60", "credit terms"],
    "对账": ["statement", "account statement", "reconciliation"],
    "催款": ["overdue", "unpaid", "payment reminder", "pending payment"],

    # 交期、物流与发货
    "交期": ["lead time", "delivery date", "delivery time", "shipping date", "eta"],
    "货期": ["lead time", "production time", "delivery schedule"],
    "延误": ["delay", "delayed", "late", "postponed"],
    "发货": ["shipment", "shipping", "dispatch", "dispatched", "shipped"],
    "出货": ["shipment", "delivery", "dispatch", "ship"],
    "物流": ["logistics", "shipping", "courier", "express", "forwarder"],
    "快递": ["courier", "express", "fedex", "dhl", "ups", "tnt"],
    "单号": ["tracking number", "tracking #", "waybill", "awb"],
    "运费": ["freight", "shipping cost", "shipping fee", "postage"],
    "空运": ["air freight", "by air", "air shipment"],
    "海运": ["sea freight", "by sea", "ocean shipping"],
    "清关": ["customs clearance", "customs", "duty"],

    # 品质与客诉
    "质量": ["quality", "defect", "inspection", "grade"],
    "品质": ["quality", "finishing", "standard"],
    "瑕疵": ["defect", "defective", "flaw", "blemish", "imperfect"],
    "缺陷": ["defect", "flaw", "fault", "problem"],
    "划痕": ["scratch", "scratched", "scuff", "mark"],
    "色差": ["color difference", "pantone", "off color", "shade match"],
    "电镀": ["plating", "finish", "gold plating", "nickel", "brass", "bronze"],
    "破损": ["damaged", "broken", "cracked", "damage"],
    "投诉": ["complaint", "claim", "dispute", "issue", "dissatisfied"],
    "重做": ["remake", "reproduce", "reproduction", "replace"],
    "补货": ["replenish", "replacement", "remake"],

    # 包装与规格
    "包装": ["packaging", "packing", "polybag", "box", "carton"],
    "数量": ["quantity", "qty", "pieces", "pcs"],
    "尺寸": ["size", "dimension", "diameter", "thickness", "mm", "inch"],
    "工艺": ["craft", "process", "technique", "workmanship"],
    "配件": ["accessory", "attachment", "clutch", "butterfly clutch"],

    # 核心定制产品
    "徽章": ["pin", "enamel pin", "lapel pin", "badge", "soft enamel", "hard enamel"],
    "硬币": ["coin", "challenge coin", "commemorative coin"],
    "钥匙扣": ["keychain", "key ring", "key chain", "key fob"],
    "布贴": ["patch", "embroidered patch", "woven patch", "pvc patch"],
    "奖牌": ["medal", "medallion", "ribbon"],
    "挂绳": ["lanyard", "neck strap"],
    "贴纸": ["sticker", "decal", "label"]
}

def expand_trade_keywords(query_or_tokens: Union[str, List[str]]) -> List[str]:
    """
    Expands input Chinese or mixed trade terms into a list of English synonyms/keywords.
    Keeps original tokens and appends matched English terms without duplicates.
    """
    if isinstance(query_or_tokens, str):
        text = query_or_tokens.lower()
        extracted: Set[str] = set()
        for ch_key, en_list in FOREIGN_TRADE_TERMS.items():
            if ch_key in text:
                for en_term in en_list:
                    extracted.add(en_term)
        return list(extracted)
    
    elif isinstance(query_or_tokens, list):
        extracted: Set[str] = set()
        for item in query_or_tokens:
            lowered = str(item).lower().strip()
            if not lowered:
                continue
            for ch_key, en_list in FOREIGN_TRADE_TERMS.items():
                if ch_key in lowered or lowered in ch_key:
                    for en_term in en_list:
                        extracted.add(en_term)
        return list(extracted)
    
    return []
