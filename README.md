# 🎵 → 🎼 Audio/Video → Sheet nhạc (Web)

Web app **React + Vite** chuyển file **audio hoặc video** thành **sheet nhạc** —
chạy **hoàn toàn trong trình duyệt**, không cần server, không upload file đi đâu.

Lõi nhận diện nốt dùng **[Basic Pitch](https://github.com/spotify/basic-pitch)**
(mô hình AI mã nguồn mở của Spotify, bản TensorFlow.js), sau đó tự lượng tử hóa
nhịp, sinh **MusicXML** và khắc bản nhạc bằng **[Verovio](https://www.verovio.org/)** (WASM).

```
file audio/video (mp3/wav/flac/ogg/m4a/mp4/mov/webm)
   │  Web Audio API            → giải mã + resample 22050 Hz mono
   ▼
  PCM mono 22050 Hz
   │  Basic Pitch (AI, TFJS)   → nhận diện cao độ / hợp âm (đa âm)
   ▼
  Note events  ──────────────► MIDI (.mid)   (giữ nhịp thô, trung thực)
   │  Quantizer (tự viết)      → làm tròn nhịp, tách 2 tay, dấu nối qua vạch nhịp
   ▼
  MusicXML  ─────────────────► .musicxml     (mở/sửa trong MuseScore)
   │  Verovio (WASM)           → khắc bản nhạc
   ▼
  Sheet nhạc (SVG)  ─────────► In / Lưu PDF
```

Đây là phiên bản web của script Python `audio2sheet`. Các mặc định (ngưỡng AI,
điểm tách tay trái/phải C4, tempo, nhịp…) được giữ cho khớp.

---

## 1. Yêu cầu

- **Node.js ≥ 18** (khuyến nghị 20 LTS). Máy đang để mặc định Node 16 thì chuyển:
  ```bash
  nvm use 20      # hoặc: nvm install 20 && nvm use 20
  ```
- Trình duyệt **Chrome/Edge** (khuyến nghị) — `decodeAudioData` của Chromium đọc
  được cả track âm thanh trong file **video** (mp4/mov/webm). Firefox/Safari chạy
  tốt với file **audio**; với video thì tùy phiên bản.

## 2. Cài đặt & chạy

```bash
npm install
npm run dev          # mở http://localhost:5173
```

Build production:

```bash
npm run build        # ra thư mục dist/
npm run preview      # xem thử bản build
```

> Lần đầu bấm “Chuyển thành sheet”, trình duyệt sẽ tải mô hình AI (~1 MB) và
> Verovio (~2.4 MB gzip) — nên hơi lâu một chút; các lần sau dùng cache.

## 3. Cách dùng

1. Kéo–thả (hoặc bấm chọn) một file **audio/video**.
2. Đặt **tiêu đề** rồi bấm **🎼 Chuyển thành sheet**.
3. Bấm **▶ Nghe thử (piano)** để nghe lại các nốt AI nhận được — phát bằng mẫu
   âm piano thật (soundfont). *Lần đầu cần mạng để tải mẫu âm.* Phát theo timing
   gốc (không lượng tử hóa) để phản ánh đúng những gì AI nghe được.
4. Xem bản nhạc, rồi tải về:
   - **MIDI (.mid)** — giữ nguyên nhịp thô từ AI, hợp để mở trong DAW.
   - **MusicXML** — mở/sửa trong [MuseScore](https://musescore.org) (miễn phí).
   - **PDF / In** — mở hộp thoại in của trình duyệt → chọn *Save as PDF* (vector, nét).

### Bảng điều khiển

| Mục | Tác dụng |
|---|---|
| **Bố cục** | *Piano (2 tay)* = khuông kép tách khóa Sol/Fa, hoặc *Giai điệu (1 khuông)* cho sáo/giọng hát/1 nhạc cụ. |
| **Tempo (BPM)** | Ảnh hưởng trực tiếp cách chia phách/nốt. Đặt sai tempo → nhịp lệch dù cao độ vẫn đúng. |
| **Số chỉ nhịp** | 4/4, 3/4, 2/4, 2/2, 6/8, 3/8. |
| **Lưới làm tròn** | Độ mịn khi quantize: nốt đen / móc đơn / móc kép (1/16). |
| **Hóa biểu** | Chọn giọng (số dấu thăng/giáng) — cũng quyết định ghi thăng hay giáng. |
| **Ranh giới 2 tay** | Cao độ MIDI ngăn tay phải/trái (mặc định C4 = 60). |
| **Ngưỡng onset/frame** | Cao = ít nốt nhiễu hơn (dễ sót); thấp = bắt nhiều nốt hơn. |
| **Độ dài nốt tối thiểu** | Lọc các nốt quá ngắn (rác). |

> Đổi các mục trong khung **Ký âm** sẽ cập nhật bản nhạc **ngay** (không chạy lại AI).
> Đổi **Độ nhạy nhận diện** rồi bấm **↻ Nhận diện lại** mới chạy lại mô hình.

## 4. Mẹo cho kết quả tốt

1. **Bản thu càng sạch, đơn giản càng tốt** — piano độc tấu / một dòng giai điệu
   rõ cho kết quả tốt nhất. Mix dày nhiều nhạc cụ sẽ kém chính xác.
2. **Đặt đúng tempo** trước khi đọc bản nhạc.
3. **Tinh chỉnh lần cuối trong MuseScore** — mở file `.musicxml`. Đây là bước gần
   như luôn cần với *mọi* công cụ tự động.

## 5. Giới hạn (nói thật)

- Không ngang các sản phẩm thương mại (AnthemScore, Klang.io…) vốn huấn luyện
  nhiều năm trên dữ liệu độc quyền. App này dựng trên mô hình mã nguồn mở.
- Tốt với **piano / giai điệu rõ**; kém với **mix nhiều bè, nhiều nhạc cụ, thu ồn**.
- Tách tay trái/phải chỉ theo **ngưỡng cao độ**, không hiểu ngữ cảnh như người chơi.
- Tempo, hóa biểu, cách ghi nhịp là **suy đoán** → xem như **bản nháp tốt**.
- **Khác với bản Python:** quantizer ở đây dùng **lưới chia 2 (đến 1/16)**, **chưa
  hỗ trợ chùm 3 (triplet)** — phần mà `music21` lo giúp ở bản Python. Nhịp có
  triplet sẽ bị làm tròn về lưới gần nhất.

## 6. Kiểm thử

```bash
npm test        # unit test: quantizer (điền đủ ô nhịp, dấu nối), MusicXML, MIDI,
                # và validate bằng cách LOAD THẬT vào Verovio
```

End-to-end (cần dev server đang chạy + Google Chrome):

```bash
npm run dev                 # ở một terminal
npm run e2e                 # tạo WAV hợp âm rải, nạp vào app thật, kiểm tra sheet render
```

`npm run e2e` tổng hợp một file WAV (C4–E4–G4–C5), điều khiển Chrome headless chạy
toàn bộ pipeline và xác nhận AI nhận đúng số nốt + Verovio khắc ra bản nhạc
(screenshot lưu ở `/tmp/e2e-sheet.png`).

## 7. Cấu trúc mã

```
src/
  lib/
    audio.ts        # giải mã + resample 22050 Hz mono (Web Audio API)
    transcribe.ts   # Basic Pitch: audio -> note events (dynamic import)
    midi.ts         # note events -> MIDI bytes (@tonejs/midi)
    music.ts        # nhạc lý: MIDI -> tên nốt / hóa biểu
    quantize.ts     # lượng tử hóa -> mô hình measure/voice (tách 2 tay, dấu nối)
    musicxml.ts     # mô hình -> MusicXML 4.0
    verovio.ts      # MusicXML -> SVG (Verovio WASM, dynamic import)
    *.test.ts       # unit + tích hợp Verovio
  components/        # Dropzone, Controls, SheetMusic
  App.tsx           # orchestration toàn pipeline
public/model/       # trọng số mô hình Basic Pitch (phục vụ cục bộ)
```

## 8. Thành phần mã nguồn mở

| Việc | Thư viện | Giấy phép |
|---|---|---|
| Audio → nốt (AI) | [Basic Pitch](https://github.com/spotify/basic-pitch-ts) (Spotify) | Apache-2.0 |
| Chạy mô hình | TensorFlow.js | Apache-2.0 |
| MIDI | [@tonejs/midi](https://github.com/Tonejs/Midi) | MIT |
| Khắc bản nhạc | [Verovio](https://github.com/rism-digital/verovio) | LGPL-3.0 |
