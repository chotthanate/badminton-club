# Badminton Club

เว็บหลังบ้านสำหรับแอดมินกลุ่มแบด สมาชิกไม่ต้องเข้าเว็บและจะลงชื่อผ่าน
LINE เท่านั้น แอดมินใช้เว็บสร้างรอบ เช็กคนมาจริง ปรับสัดส่วนการเล่น
คิดค่าใช้จ่าย และสรุปยอดส่งกลับกลุ่ม

## Run

```powershell
npm install
npm run dev
```

คัดลอก `.env.example` เป็น `.env.local` แล้วใส่ Supabase Project URL และ
Publishable key ก่อนเริ่มเชื่อมข้อมูลจริง ห้ามใส่ Secret key หรือ service-role
key ในไฟล์ของ frontend

หน้าเว็บรับเฉพาะรหัสเข้าเว็บ ส่วนอีเมลบัญชีแอดมินถูกกำหนดด้วย
`VITE_ADMIN_EMAIL` และไม่ต้องแสดงให้ผู้ใช้เห็น รหัสผ่านไม่ควรเก็บในไฟล์ `.env`
หรือ source code

เปิดในเครื่อง:

```text
http://127.0.0.1:5173/badminton-club/
```

ถ้าเปิดจากมือถือใน Wi-Fi เดียวกัน ให้ใช้ IP ของคอมแทน `127.0.0.1`

## Deploy

ตั้ง GitHub Pages ให้ build ด้วย:

```powershell
npm ci
npm run build
```

แล้ว publish โฟลเดอร์ `dist`

## Next

- ใส่ `LINE_CHANNEL_SECRET` และ `LINE_CHANNEL_ACCESS_TOKEN` ใน Supabase secrets
- ตั้ง webhook ของ LINE ไปที่ Edge Function `line-bot`
- เชิญ LINE Official Account เข้ากลุ่มและส่งข้อความหนึ่งครั้งเพื่อผูกกลุ่ม

รายละเอียดการตั้งค่า LINE Developers อยู่ใน `supabase/README.md`

## Test

```powershell
npm test
```
