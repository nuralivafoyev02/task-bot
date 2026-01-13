const { Telegraf, Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OWNER_ID = parseInt(process.env.OWNER_ID);
const WEBAPP_URL = process.env.WEBAPP_URL;

const bot = new Telegraf(BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ROLE CHECK MIDDLEWARE
const requireRole = (roles = []) => async (ctx, next) => {
    const { data: user, error } = await supabase
        .from('profiles')
        .select('role')
        .eq('telegram_id', ctx.from.id)
        .single();

    if (error || !user || !roles.includes(user.role)) {
        return ctx.reply("❌ Sizda bu amal uchun ruxsat yo‘q.");
    }
    return next();
};

// Har bir rol uchun maxsus tugmalar
const getMenuByRole = (role) => {
    const buttons = [[Markup.button.webApp('Ilovani ochish 📱', WEBAPP_URL)]];
    
    if (role === 'owner' || role === 'admin') {
        buttons.push([Markup.button.text('➕ Yangi vazifa'), Markup.button.text('👥 Jamoalarim')]);
    }
    
    if (role === 'owner') {
        buttons.push([Markup.button.text('📊 Foydalanuvchilar'), Markup.button.text('⚙️ Tizim holati')]);
    }

    return Markup.keyboard(buttons).resize();
};

// Har bir rol uchun yozma yo'riqnoma
const getHelpText = (role, name) => {
    if (role === 'user') {
        return (
`👋 Salom, ${name}!

Siz *oddiy foydalanuvchi* sifatida tizimga kirdingiz.

🧩 *Siz nimalarni qila olasiz?*
• Sizga biriktirilgan vazifalarni ko‘rish
• Vazifalar bo‘yicha ishlash
• Mini Ilova orqali barcha vazifalarni boshqarish

📌 *Mavjud buyruqlar:*
/start — Menyuni yangilash
/mytasks — Mening vazifalarim (Mini Ilovada)

📱 *Mini Ilova* tugmasi orqali vazifalarni qulay boshqaring.
`
        );
    }

    if (role === 'admin') {
        return (
`👋 Salom, ${name}!

Siz *ADMIN* sifatida tizimga kirdingiz.

🧩 *Siz nimalarni qila olasiz?*
• Foydalanuvchilarga vazifa biriktirish
• Jamoalar yaratish va boshqarish
• Bot orqali task yaratish

📌 *Mavjud buyruqlar:*
/start — Menyuni yangilash
/newtask — Vazifa biriktirish (@username yoki reply)
/createtask — Reply orqali vazifa yaratish
/newteam — Yangi jamoa ochish

💡 Maslahat: vazifa berishda user xabariga reply qilish eng qulay usul.
`
        );
    }

    if (role === 'owner') {
        return (
`👑 Salom, ${name}!

Siz *OWNER* sifatida tizimga kirdingiz — to‘liq nazorat sizda.

🧩 *Siz nimalarni qila olasiz?*
• Admin tayinlash
• Barcha foydalanuvchilarni ko‘rish
• Istalgan userga task yaratish
• Tizimni to‘liq boshqarish

📌 *Mavjud buyruqlar:*
/start — Menyuni yangilash
/users — Foydalanuvchilar ro‘yxati
/newadmin — Reply orqali admin tayinlash
/newtask — Vazifa biriktirish
/createtask — Botdan task yaratish
/newteam — Jamoa ochish

⚙️ Sizda eng yuqori huquqlar mavjud.
`
        );
    }
};


// --- BOT LOGIKASI ---

bot.start(async (ctx) => {
    try {
        const { id, username, first_name } = ctx.from;
        
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

        await ctx.reply(getHelpText(profile.role, first_name), {
            parse_mode: 'Markdown',
            ...getMenuByRole(profile.role)
        });

        if (id !== OWNER_ID && !error) { // Faqat birinchi marta kirganda bildirishnoma (ixtiyoriy)
             // Eski xabardor qilish kodi o'z joyida
        }
    } catch (err) {
        console.error("Start Error:", err);
    }
});

// --- OWNER EXCLUSIVE FEATURES ---
// ================================
// OWNER: /newadmin (REPLY ORQALI)
// ================================
bot.command('newadmin', async (ctx) => {
    try {
        // 🔐 Faqat OWNER
        if (ctx.from.id !== OWNER_ID) {
            return ctx.reply("❌ Faqat Owner admin tayinlay oladi.");
        }

        // ❗ Reply shart
        if (!ctx.message.reply_to_message) {
            return ctx.reply(
                "⚠️ Admin qilmoqchi bo‘lgan foydalanuvchi xabariga reply qilib `/newadmin` yozing.",
                { parse_mode: 'Markdown' }
            );
        }

        const targetTgId = ctx.message.reply_to_message.from.id;

        const { data: user, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('telegram_id', targetTgId)
            .single();

        if (error || !user) {
            return ctx.reply("❌ Foydalanuvchi botda ro‘yxatdan o‘tmagan.");
        }

        if (user.role === 'admin') {
            return ctx.reply("⚠️ Bu foydalanuvchi allaqachon Admin.");
        }

        if (user.role === 'owner') {
            return ctx.reply("👑 Owner eng yuqori huquqqa ega.");
        }

        await supabase
            .from('profiles')
            .update({ role: 'admin' })
            .eq('telegram_id', targetTgId);

        ctx.reply("✅ Foydalanuvchi Admin qilindi!");
        await bot.telegram.sendMessage(
            targetTgId,
            "🎉 Tabriklaymiz! Siz Admin etib tayinlandingiz."
        );

    } catch (err) {
        console.error("NEWADMIN ERROR:", err);
        ctx.reply("⚠️ Xatolik yuz berdi.");
    }
});


// ==================================================
// ADMIN / OWNER: BOTDAN TURIB TASK YARATISH (REPLY)
// ==================================================
bot.command('createtask', async (ctx) => {
    try {
        const { data: creator, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('telegram_id', ctx.from.id)
            .single();

        if (error || creator.role === 'user') {
            return ctx.reply("❌ Sizda vazifa yaratish huquqi yo‘q.");
        }

        if (!ctx.message.reply_to_message) {
            return ctx.reply(
                "⚠️ Vazifa beriladigan foydalanuvchi xabariga reply qilib:\n`/createtask Vazifa nomi`",
                { parse_mode: 'Markdown' }
            );
        }

        const title = ctx.message.text.split(' ').slice(1).join(' ');
        if (!title) {
            return ctx.reply("⚠️ Vazifa nomini yozing.");
        }

        const targetTgId = ctx.message.reply_to_message.from.id;

        const { data: worker, error: workerError } = await supabase
            .from('profiles')
            .select('*')
            .eq('telegram_id', targetTgId)
            .single();

        if (workerError || !worker) {
            return ctx.reply("❌ Foydalanuvchi botda ro‘yxatdan o‘tmagan.");
        }

        const { error: taskError } = await supabase
            .from('tasks')
            .insert([{
                title,
                assigned_to: worker.id,
                created_by: creator.id,
                team_id: creator.current_team_id || null,
                status: 'pending'
            }]);

        if (taskError) {
            console.error(taskError);
            return ctx.reply("⚠️ Vazifa yaratishda xatolik.");
        }

        ctx.reply("✅ Vazifa muvaffaqiyatli yaratildi!");

        await bot.telegram.sendMessage(
            worker.telegram_id,
            `📝 *Yangi vazifa*\n\n📌 ${title}\n👤 Kimdan: @${ctx.from.username || 'Admin'}`,
            { parse_mode: 'Markdown' }
        );

    } catch (err) {
        console.error("CREATETASK ERROR:", err);
        ctx.reply("⚠️ Xatolik yuz berdi.");
    }
});



module.exports = async (req, res) => {
    if (req.method === 'POST') {
        await bot.handleUpdate(req.body);
        res.status(200).json({ ok: true });
    } else {
        res.status(200).send('Bot Status: Active');
    }
};