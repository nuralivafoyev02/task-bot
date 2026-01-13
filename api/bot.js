const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

// 1. O'zgaruvchilarni tekshirish (Xatolikni oldini olish)
const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = parseInt(process.env.OWNER_ID);
const WEBAPP_URL = process.env.WEBAPP_URL;

if (!BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY) {
    console.error("Muhim Environment Variables yetishmayapti!");
}

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// UX: Chiroyli asosiy menyu
const mainMenu = (role) => {
    return Markup.keyboard([
        [Markup.button.webApp('Ilovani ochish 📱', WEBAPP_URL)],
        role !== 'user' ? [Markup.button.text('Yangi jamoa 👥'), Markup.button.text('Yangi vazifa 📝')] : []
    ].filter(row => row.length > 0)).resize();
};

// 1. START - Avtomatik ro'yxatdan o'tkazish (Upsert bilan)
bot.start(async (ctx) => {
    try {
        const { id, username, first_name } = ctx.from;
        
        // Profilni yaratish yoki mavjudini yangilash (Upsert)
        const { data: profile, error } = await supabase
            .from('profiles')
            .upsert({ 
                telegram_id: id, 
                username: username || 'user', 
                full_name: first_name,
                role: id === OWNER_ID ? 'owner' : 'user'
            }, { onConflict: 'telegram_id' })
            .select().single();

        if (error) throw error;

        await ctx.reply(`Assalomu alaykum, ${first_name}!\nSizning holatingiz: **${profile.role.toUpperCase()}**`, {
            parse_mode: 'Markdown',
            ...mainMenu(profile.role)
        });

        // Agar yangi user bo'lsa Ownerga bildirishnoma
        if (id !== OWNER_ID) {
            await bot.telegram.sendMessage(OWNER_ID, `🆕 Yangi foydalanuvchi:\n👤 ${first_name} (@${username})\nID: \`${id}\``, {
                parse_mode: 'Markdown',
                ...Markup.inlineKeyboard([
                    [Markup.button.callback('⚡️ Admin qilish', `make_admin_${id}`)],
                    [Markup.button.callback('👥 Jamoaga qo\'shish', `assign_team_${id}`)]
                ])
            });
        }
    } catch (err) {
        console.error("Start Error:", err);
        ctx.reply("❌ Xatolik yuz berdi. Iltimos qaytadan urinib ko'ring.");
    }
});

// 2. ADMIN TAYINLASH
bot.action(/make_admin_(\d+)/, async (ctx) => {
    try {
        if (ctx.from.id !== OWNER_ID) return ctx.answerCbQuery("Taqiqlangan!");
        const targetId = ctx.match[1];
        
        await supabase.from('profiles').update({ role: 'admin' }).eq('telegram_id', targetId);
        bot.telegram.sendMessage(targetId, "🎉 Tabriklaymiz! Siz Admin bo'ldingiz.");
        ctx.editMessageText("✅ Foydalanuvchi Admin qilindi.");
    } catch (e) { ctx.reply("Xato: " + e.message); }
});

// 3. JAMOA YARATISH
bot.command('newteam', async (ctx) => {
    try {
        const { data: user } = await supabase.from('profiles').select('id, role').eq('telegram_id', ctx.from.id).single();
        if (user.role === 'user') return ctx.reply("❌ Faqat Adminlar jamoa ochishi mumkin.");

        const name = ctx.message.text.split(' ').slice(1).join(' ');
        if (!name) return ctx.reply("⚠️ Format: `/newteam JamoaNomi`", { parse_mode: 'Markdown' });

        const { data: team, error } = await supabase.from('teams').insert([{ name, created_by: user.id }]).select().single();
        if (error) throw error;

        await supabase.from('team_members').insert([{ team_id: team.id, user_id: user.id }]);
        ctx.reply(`✅ **${name}** jamoasi yaratildi.`, { parse_mode: 'Markdown' });
    } catch (e) { ctx.reply("Xato: " + e.message); }
});

// 4. JAMOA GA QO'SHISH (UX Yaxshilangan)
bot.action(/assign_team_(\d+)/, async (ctx) => {
    const { data: teams } = await supabase.from('teams').select('*');
    const targetTgId = ctx.match[1];
    
    if (!teams || teams.length === 0) return ctx.reply("Hali hech qanday jamoa yo'q.");
    
    const buttons = teams.map(t => [Markup.button.callback(`🔹 ${t.name}`, `add_to_team_${t.id}_${targetTgId}`)]);
    ctx.reply("Qaysi jamoaga qo'shmoqchisiz?", Markup.inlineKeyboard(buttons));
});

bot.action(/add_to_team_(.+)_(\d+)/, async (ctx) => {
    try {
        const [_, teamId, targetTgId] = ctx.match;
        const { data: user } = await supabase.from('profiles').select('id').eq('telegram_id', targetTgId).single();
        
        await supabase.from('team_members').upsert([{ team_id: teamId, user_id: user.id }], { onConflict: 'team_id, user_id' });
        
        bot.telegram.sendMessage(targetTgId, "🎊 Sizni jamoaga qo'shishdi! Ilovani ochib ko'ring.");
        ctx.editMessageText("✅ Muvaffaqiyatli qo'shildi.");
    } catch (e) { ctx.reply("Xato: " + e.message); }
});

// 5. VAZIFA YARATISH
bot.command('newtask', async (ctx) => {
    try {
        const parts = ctx.message.text.split(' ');
        if (parts.length < 3) return ctx.reply("⚠️ Format: `/newtask @username Vazifa nomi`", { parse_mode: 'Markdown' });

        const targetUsername = parts[1].replace('@', '');
        const title = parts.slice(2).join(' ');

        const { data: creator } = await supabase.from('profiles').select('*').eq('telegram_id', ctx.from.id).single();
        if (creator.role === 'user') return ctx.reply("❌ Sizda huquq yo'q.");
        if (!creator.current_team_id) return ctx.reply("❌ Avval Ilovada jamoani tanlang (Switch team).");

        const { data: worker } = await supabase.from('profiles').select('*').eq('username', targetUsername).single();
        if (!worker) return ctx.reply("❌ Foydalanuvchi botda ro'yxatdan o'tmagan.");

        const { error } = await supabase.from('tasks').insert([{
            title, team_id: creator.current_team_id, assigned_to: worker.id, created_by: creator.id
        }]);

        if (error) throw error;

        ctx.reply("🚀 Vazifa yuborildi!");
        bot.telegram.sendMessage(worker.telegram_id, `📝 **Yangi vazifa:** ${title}\n👤 **Kimdan:** @${ctx.from.username}`, { parse_mode: 'Markdown' });
    } catch (e) { ctx.reply("Xato: " + e.message); }
});

// 6. VERCEL WEBHOOK HANDLING (Eng xavfsiz usul)
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body);
            return res.status(200).json({ ok: true });
        }
        res.status(200).send('Bot is online!');
    } catch (err) {
        console.error("Webhook error:", err);
        // Telegram xabarni qayta yuboravermasligi uchun 200 qaytaramiz
        res.status(200).json({ error: "Captured" });
    }
};