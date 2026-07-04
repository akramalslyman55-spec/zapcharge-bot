from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, CallbackQueryHandler, ContextTypes

BOT_TOKEN = "8874153125:AAETxa6Ed0I36jLC1rX7GocyxapJ0np9VFQ"

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    keyboard = [
        [InlineKeyboardButton("🛒 المنتجات", callback_data="products")],
        [InlineKeyboardButton("💰 رصيدي", callback_data="balance")],
        [InlineKeyboardButton("🆘 الدعم", callback_data="support")],
    ]
    reply_markup = InlineKeyboardMarkup(keyboard)
    await update.message.reply_text(
        "أهلاً فيك بمتجر Zapcharge ⚡\n"
        "شحن فوري وآمن لجميع الألعاب والتطبيقات.\n\n"
        "اختر من القائمة تحت:",
        reply_markup=reply_markup
    )

async def button_handler(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()

    if query.data == "products":
        await query.edit_message_text("📦 قائمة المنتجات قريباً رح تنضاف هون.")
    elif query.data == "balance":
        await query.edit_message_text("💰 رصيدك الحالي: 0$")
    elif query.data == "support":
        await query.edit_message_text("🆘 الدعم رح يتفعل قريباً، تابعنا لحتى نضيف الرابط.")

def main():
    app = Application.builder().token(BOT_TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(CallbackQueryHandler(button_handler))
    print("البوت شغال...")
    app.run_polling()

if __name__ == "__main__":
    main()
