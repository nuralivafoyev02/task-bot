const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const bot = new Telegraf(process.env.BOT_TOKEN);
// Admin huquqi bilan ishlash uchun service_role key ishlatiladi
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const OWNER_ID = parseInt(process.env.OWNER_ID); // Sizning Telegram ID'ngiz

// 1. /start - Ro'yxatdan o'tish va bildirishnoma
bot.start(async (ctx) => {
    const { id, username, first_name, last_name } = ctx.from;
    const fullName = `${first_name} ${last_name || ''}`.trim();

    // Profilni tekshirish yoki yaratish
    let { data: profile, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('telegram_id', id)
        .single();

    if (!profile) {
        const { data: newProfile } = await supabase
            .from('profiles')
            .insert([{ 
                telegram_id: id, 
                username: username, 
                full_name: fullName,
                role: id === OWNER_ID ? 'owner' : 'user' 
            }])
            .select().single();
        profile = newProfile;

        // Ownerga (Sizga) xabar berish
        if (id !== OWNER_ID) {
            await bot.telegram.sendMessage(OWNER_ID, 
                `🆕 Yangi foydalanuvchi: ${fullName} (@${username})\nID: ${id}`,
                Markup.inlineKeyboard([
                    [Markup.button.callback('Admin qilish ⚡️', `make_admin_${id}`)],
                    [Markup.button.callback('Jamoaga qo\'shish 👥', `assign_team_${id}`)]
                ])
            );
        }
    }

    const welcomeMsg = profile.role === 'owner' 
        ? "Salom Boss! Tizim nazorat ostida. 🫡" 
        : `Xush kelibsiz, ${fullName}! Adminlar sizni jamoaga qo'shishini kuting.`;

    ctx.reply(welcomeMsg, Markup.keyboard([
        [Markup.button.webApp('Mini Appni ochish 📱', process.env.WEBAPP_URL)]
    ]).resize());
});

// 2. Admin tayinlash (Faqat Owner uchun)
bot.action(/make_admin_(\d+)/, async (ctx) => {
    if (ctx.from.id !== OWNER_ID) return ctx.answerCbQuery("Sizda huquq yo'q!");
    
    const targetId = ctx.match[1];
    const { error } = await supabase
        .from('profiles')
        .update({ role: 'admin' })
        .eq('telegram_id', targetId);

    if (!error) {
        ctx.answerCbQuery("Foydalanuvchi Admin qilindi!");
        bot.telegram.sendMessage(targetId, "Siz ushbu botda Admin etib tayinlandingiz! 🛠");
        ctx.editMessageText(`✅ @${ctx.callbackQuery.from.username} foydalanuvchini Admin qildi.`);
    }
});

// 3. Jamoaga qo'shish logikasi (Adminlar va Owner uchun)
bot.action(/assign_team_(\d+)/, async (ctx) => {
    // Jamoalar ro'yxatini bazadan olish
    const { data: teams } = await supabase.from('teams').select('*');
    const targetUserId = ctx.match[1];

    if (!teams || teams.length === 0) {
        return ctx.reply("Hali birorta ham jamoa yaratilmagan. Avval jamoa yarating.");
    }

    const buttons = teams.map(team => [
        Markup.button.callback(team.name, `add_to_team_${team.id}_${targetUserId}`)
    ]);

    ctx.reply("Qaysi jamoaga qo'shish kerak?", Markup.inlineKeyboard(buttons));
});

// 4. Tanlangan jamoaga haqiqiy qo'shish
bot.action(/add_to_team_(.+)_(\d+)/, async (ctx) => {
    const teamId = ctx.match[1];
    const targetTgId = ctx.match[2];

    const { data: user } = await supabase.from('profiles').select('id').eq('telegram_id', targetTgId).single();
    
    const { error } = await supabase
        .from('team_members')
        .insert([{ team_id: teamId, user_id: user.id }]);

    if (!error) {
        ctx.answerCbQuery("Jamoaga qo'shildi!");
        bot.telegram.sendMessage(targetTgId, "Siz yangi jamoaga qo'shildingiz! Mini App orqali vazifalarni ko'rishingiz mumkin.");
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body);
        res.status(200).send('OK');
    } else {
        res.status(200).send('Bot ishlayapti...');
    }
};