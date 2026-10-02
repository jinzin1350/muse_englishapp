#!/usr/bin/env python3
"""Build lessons/c1/2026-10-01.json manifest for the C1 economics & finance lesson."""
import json, os

BASE = os.path.expanduser("~/workspace/english-app-static")
D = "media/c1/2026-10-01"

words = [
 dict(word="leverage", pos="verb",
      meaning="to use borrowed money or influence to increase the potential scale of gains (and losses)",
      example="The firm used leverage to buy far more assets than its cash alone would allow.",
      pronunciation="LEH-vuh-rij", persian="اهرم؛ استفاده از بدهی یا نفوذ برای افزایش بازده"),
 dict(word="liquidity", pos="noun",
      meaning="how quickly and easily an asset can be converted to cash without losing value",
      example="Real estate has much lower liquidity than stocks or bonds.",
      pronunciation="lih-KWIH-duh-tee", persian="نقدشوندگی"),
 dict(word="volatility", pos="noun",
      meaning="the degree of rapid, unpredictable price changes in a market",
      example="Oil price volatility makes long-term budgeting difficult for airlines.",
      pronunciation="vah-luh-TIH-luh-tee", persian="نوسان؛ بی‌ثباتی قیمت"),
 dict(word="deficit", pos="noun",
      meaning="the amount by which spending exceeds income or revenue",
      example="The government ran a deficit of two percent of GDP last year.",
      pronunciation="DEH-fih-sit", persian="کسری بودجه"),
 dict(word="surplus", pos="noun",
      meaning="an amount left over after spending; the excess of income over expenses",
      example="The trade surplus reached a record high this quarter.",
      pronunciation="SUR-plus", persian="مازاد"),
 dict(word="arbitrage", pos="noun",
      meaning="buying cheap in one market and selling higher in another for a nearly risk-free profit",
      example="Algorithmic traders profit from arbitrage between different exchanges.",
      pronunciation="AR-bih-trahzh", persian="آربیتراژ؛ بهره‌برداری از اختلاف قیمت"),
 dict(word="speculation", pos="noun",
      meaning="investment in risky assets in the hope of making a large profit",
      example="Pure speculation drove the meme stock to absurd levels.",
      pronunciation="speh-kyuh-LEY-shun", persian="سفته‌بازی؛ سوداگری"),
 dict(word="collateral", pos="noun",
      meaning="an asset pledged as security for a loan, seized if the borrower defaults",
      example="The bank demanded collateral before approving the mortgage.",
      pronunciation="kuh-LAH-tuh-rul", persian="وثیقه؛ تضمین"),
 dict(word="dividend", pos="noun",
      meaning="a share of a company's profits paid out to its shareholders",
      example="The company raised its dividend for the fifth consecutive year.",
      pronunciation="DIH-vih-dend", persian="سود سهام"),
 dict(word="equity", pos="noun",
      meaning="the ownership value in a company or asset after all debts are subtracted",
      example="His equity in the startup grew tenfold after the public offering.",
      pronunciation="EH-kwih-tee", persian="حقوق صاحبان سهام؛ ارزش خالص مالکیت"),
 dict(word="bubble", pos="noun",
      meaning="a rapid rise in asset prices far above their real value, followed by a crash",
      example="The housing bubble burst in 2008, wiping out trillions in wealth.",
      pronunciation="BUH-bul", persian="حباب قیمتی"),
 dict(word="downturn", pos="noun",
      meaning="a decline in economic or business activity",
      example="Retail sales fell sharply during the economic downturn.",
      pronunciation="DOWN-turn", persian="افت؛ کاهش فعالیت اقتصادی"),
 dict(word="stimulus", pos="noun",
      meaning="government spending or policy measures aimed at boosting the economy",
      example="The central bank announced a stimulus package to revive growth.",
      pronunciation="STIH-myuh-lus", persian="بسته محرک اقتصادی"),
 dict(word="recession", pos="noun",
      meaning="a prolonged period of economic decline, typically two quarters of shrinking output",
      example="Economists fear a global recession could begin next year.",
      pronunciation="rih-SEH-shun", persian="رکود اقتصادی"),
 dict(word="austerity", pos="noun",
      meaning="government policies of strict spending cuts intended to reduce deficits",
      example="Austerity measures sparked protests across the capital.",
      pronunciation="aw-STEH-ruh-tee", persian="ریاضت اقتصادی"),
 dict(word="subsidize", pos="verb",
      meaning="to financially support an industry or product so its price falls",
      example="The state subsidizes renewable energy to encourage adoption.",
      pronunciation="SUB-sih-dyz", persian="یارانه دادن؛ حمایت مالی کردن"),
 dict(word="bailout", pos="noun",
      meaning="an emergency financial rescue of a failing company or economy",
      example="The airline received a government bailout to avoid bankruptcy.",
      pronunciation="BAYL-out", persian="نجات مالی اضطراری"),
 dict(word="diversification", pos="noun",
      meaning="spreading investments across different assets to reduce risk",
      example="Diversification protected her portfolio during the market crash.",
      pronunciation="dih-vur-sih-fih-KEY-shun", persian="تنوع‌بخشی"),
 dict(word="inflationary", pos="adjective",
      meaning="causing or relating to inflation; tending to raise prices",
      example="Printing too much money to fund spending is inflationary.",
      pronunciation="in-FLAY-shuh-neh-ree", persian="تورم‌زا؛ تورمی"),
 dict(word="hedge", pos="verb",
      meaning="to make investments that reduce the risk of financial losses",
      example="Investors hedge against inflation by buying gold.",
      pronunciation="HEJ", persian="پوشش ریسک دادن؛ مصون‌سازی"),
]

distractors = {
 "leverage": ["to reduce all borrowing to zero", "to divide profits equally among investors", "to sell assets at a guaranteed loss"],
 "liquidity": ["the total profit of a company", "the interest rate on a loan", "the number of employees in a firm"],
 "volatility": ["a steady, predictable increase in prices", "a government tax on trading", "the total value of all shares"],
 "deficit": ["money saved for the future", "a profit shared with workers", "a loan with no interest"],
 "surplus": ["a shortage of essential goods", "money borrowed from a bank", "a loss on an investment"],
 "arbitrage": ["buying and holding for decades", "selling everything in a panic", "setting prices by government order"],
 "speculation": ["a guaranteed government bond", "a fixed monthly salary", "a fully insured bank deposit"],
 "collateral": ["a gift with no repayment expected", "a tax paid on profits", "a fee for opening an account"],
 "dividend": ["a penalty for late payment", "the salary of the CEO", "a tax on company revenue"],
 "equity": ["the total debt of a company", "a loan from the government", "the monthly rent on an office"],
 "bubble": ["a slow, stable price increase", "a permanent fixed price", "a government price ceiling"],
 "downturn": ["a sudden economic boom", "a period of full employment", "a rise in consumer spending"],
 "stimulus": ["a cut in all public spending", "a ban on foreign trade", "a freeze on bank lending"],
 "recession": ["rapid economic expansion", "a record stock market high", "a surge in new businesses"],
 "austerity": ["unlimited government spending", "a generous welfare expansion", "a massive tax cut for all"],
 "subsidize": ["to tax an industry heavily", "to ban a product entirely", "to nationalize a company"],
 "bailout": ["a routine annual tax payment", "a planned company merger", "a voluntary donation to charity"],
 "diversification": ["putting all money in one stock", "borrowing the maximum possible", "avoiding all investments"],
 "inflationary": ["causing prices to fall", "keeping prices perfectly stable", "reducing the money supply"],
 "hedge": ["to take on maximum risk", "to ignore all market dangers", "to sell everything at once"],
}

quiz = []
for w in words:
    opts = distractors[w["word"]] + [w["meaning"]]
    # deterministic shuffle: rotate by word length
    rot = len(w["word"]) % 4
    opts = opts[rot:] + opts[:rot]
    quiz.append({"question": f"What does '{w['word']}' mean?",
                 "options": opts, "answer": opts.index(w["meaning"])})

grammar = {
 "title": "Obligation and prohibition: have to, must, should",
 "explanation": (
  "At C1 level you know the basics; the real skill is choosing the right modal for the right shade of meaning.\n\n"
  "1. have to vs must (obligation). Both express obligation, but the source differs. Use have to for external, general rules imposed by someone or something else: 'I have to wear a uniform at work.' Use must for obligation the speaker feels personally, often a decision taken in the moment: 'I must buy a new suit before the interview.' In practice, British speakers lean on this distinction more than Americans, who often use have to for both.\n\n"
  "2. mustn't vs don't have to vs needn't (prohibition vs no obligation). These three are the classic exam trap. mustn't = prohibition, something is forbidden: 'You mustn't park here.' don't have to = there is no obligation, you are free to choose: 'You don't have to come if you're busy.' needn't = don't have to in formal British English, often with a perfect infinitive for past: 'You needn't have rushed, we had plenty of time.' Note the nuance: 'You mustn't tell anyone' forbids it; 'You don't have to tell anyone' permits silence.\n\n"
  "3. should / ought to (advice and expectation). Both give advice or opinions, weaker than must: 'You should diversify your portfolio.' Ought to is a more formal, slightly old-fashioned alternative: 'Investors ought to read the fine print.' A distinct C1 use is expectation: 'The stimulus should kick in by spring' means we expect it to happen, not that anyone advises it.\n\n"
  "4. C1 nuance: strength and speaker attitude. 'You must see this report' (strong personal recommendation) vs 'You have to file by Friday' (external rule) vs 'You should probably hedge that position' (tentative advice). Choosing between them signals how strongly you feel and where the pressure comes from, which is exactly what examiners and native listeners notice."
 ),
 "examples": [
  "I have to submit my tax return by the deadline; the law requires it.",
  "I must stop checking stock prices every five minutes, it's ruining my focus.",
  "You mustn't trade on insider information; it's a criminal offence.",
  "You don't have to invest in stocks; bonds are a perfectly valid choice.",
  "She needn't have sold in a panic; the market recovered within weeks.",
  "You should keep an emergency fund worth six months of expenses.",
  "Investors ought to understand leverage before using it.",
  "With this stimulus, inflation should ease by next year.",
 ],
 "practice": [],
 "quiz": [
  {"question": "Employees ___ wear a badge at all times; it's company policy.", "options": ["must", "have to", "should", "ought to"], "answer": 1},
  {"question": "I ___ finish this report tonight; I've decided it's a priority.", "options": ["have to", "must", "don't have to", "mustn't"], "answer": 1},
  {"question": "You ___ park here; you'll get a fine.", "options": ["don't have to", "needn't", "mustn't", "shouldn't"], "answer": 2},
  {"question": "The concert is free, so you ___ pay anything.", "options": ["mustn't", "don't have to", "shouldn't", "ought not to"], "answer": 1},
  {"question": "You ___ have waited in line; I could have sent you the link.", "options": ["mustn't", "don't", "needn't", "shouldn't"], "answer": 2},
  {"question": "You ___ diversify your portfolio; it's just my advice.", "options": ["must", "have to", "should", "mustn't"], "answer": 2},
  {"question": "The new policy ___ reduce volatility, or so the minister claims.", "options": ["must", "has to", "should", "mustn't"], "answer": 2},
  {"question": "Traders ___ disclose their positions under the new rules.", "options": ["must", "have to", "should", "ought to"], "answer": 1},
  {"question": "You ___ tell anyone about the merger yet; it's confidential.", "options": ["don't have to", "mustn't", "needn't", "shouldn't"], "answer": 1},
  {"question": "Investors ___ to read the prospectus carefully before committing funds.", "options": ["must", "have", "ought", "should to"], "answer": 2},
 ],
}

manifest = {
 "date": "2026-10-01",
 "theme": "economics & finance",
 "level": "c1",
 "cefr": "C1",
 "words": [
   {"word": w["word"], "pos": w["pos"], "meaning": w["meaning"], "example": w["example"],
    "pronunciation": w["pronunciation"], "persian": w["persian"],
    "photo": f"{D}/photos/{w['word']}.jpg",
    "word_audio": f"{D}/word-audio/{w['word']}.mp3"}
   for w in words
 ],
 "pronunciation_audio": f"{D}/pronunciation.mp3",
 "podcast": {"title": "Word Kitchen: economics & finance", "audio": f"{D}/podcast.mp3",
             "cover": None, "transcript": f"{D}/podcast-transcript.txt"},
 "shadowing": {"title": "Shadowing: economics & finance", "audio": f"{D}/shadowing.mp3",
               "transcript": f"{D}/shadowing-transcript.txt"},
 "quiz": quiz,
 "grammar": grammar,
}

out = os.path.join(BASE, "lessons/c1/2026-10-01.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, "w", encoding="utf-8") as f:
    json.dump(manifest, f, ensure_ascii=False, indent=1)
print("manifest written:", out)
print("words:", len(words), "| quiz:", len(quiz), "| grammar quiz:", len(grammar["quiz"]), "| grammar examples:", len(grammar["examples"]))
