# Badminton Club

เว็บแอปจัดการกลุ่มแบดสำหรับลงชื่อผ่าน LINE, เช็กคนมาจริง, ปรับเปอร์เซ็นต์การเล่น, คิดค่าใช้จ่าย และสรุปยอดส่งกลับกลุ่ม

## Run

```powershell
npm install
npm run dev
```

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

- เพิ่ม Supabase tables สำหรับข้อมูลกลาง
- ต่อ LINE Official Account webhook
- ต่อ LIFF เพื่อผูก LINE user ID กับสมาชิกและสิทธิ์แอดมิน
