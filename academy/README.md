# Headshot Badminton Academy

แอป Academy แยกจากเว็บจัดรอบและคิวของชมรม เพื่อเก็บการลงชื่อ เช็กชื่อ เนื้อหาการเรียน KPI คะแนน ค่าใช้จ่าย และการชำระเงิน โดยไม่ใช้ตารางหรือ Supabase project เดียวกับเกมที่กำลังใช้งานจริง

## ใช้งานในเครื่อง

1. ติดตั้ง dependencies ภายในโฟลเดอร์นี้ด้วย `npm install`
2. คัดลอก `.env.example` เป็น `.env.local`
3. ใช้ `VITE_ACADEMY_DEMO_MODE=true` เพื่อดูข้อมูลจำลองโดยไม่เชื่อมฐานข้อมูล
4. รัน `npm run dev`

## เชื่อม Supabase project ใหม่

1. สร้าง Supabase project สำหรับ Academy โดยเฉพาะ
2. apply migration ใน `supabase/migrations/20261119112931_academy_core.sql`
3. deploy Edge Functions `academy-username-auth` และ `academy-line`
4. ตั้ง `VITE_ACADEMY_SUPABASE_URL`, `VITE_ACADEMY_SUPABASE_PUBLISHABLE_KEY` และ `VITE_ACADEMY_DEMO_MODE=false`
5. สร้างผู้ใช้แอดมินคนแรกจาก server/dashboard เท่านั้น โดยตั้ง `app_metadata.academy_role=admin` และเพิ่มแถวใน `academy_profiles`
6. ตั้ง secrets `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN` แล้วชี้ LINE webhook ไปที่ `academy-line`

ห้ามนำ migration นี้ไป apply กับ Supabase project ของเว็บชมรม (`biwnmiedcfmfwuciybus`) เพราะระบบตั้งใจแยกฐานข้อมูลเพื่อป้องกันผลกระทบต่อรอบ คิว และยอดเงินจริง

## สูตรค่าใช้จ่าย

`ค่าบริการของคลาส + ปัดขึ้นเป็นบาท(ค่าสนาม ÷ ผู้เช็กชื่อมา) + สินค้าของคนนั้น`

ผู้ลงชื่อแต่ไม่มาไม่ถูกคิดเงิน การกดสรุปยอดเป็น RPC แบบ atomic และทำซ้ำแล้วไม่สร้างใบเรียกเก็บเพิ่ม นักเรียนเลือกหลายใบเรียกเก็บและส่งสลิปเดียวได้
