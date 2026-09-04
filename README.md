# AI Study Sidekick — Chrome Side Panel + 9Router

Chrome Extension mẫu cho phép:

- Mở trợ lý AI ngay trong **Chrome Side Panel**.
- Bôi đen văn bản trên trang để đưa vào ngữ cảnh.
- Chuột phải đoạn đã chọn → **Hỏi AI về đoạn đã chọn**.
- Nút nhanh: **Giải thích**, **Dịch → VI**, **Tóm tắt trang**.
- Hỏi đáp dựa trên nội dung trang đang mở.
- Lưu lịch sử chat cục bộ bằng `chrome.storage.local`.
- Backend hỗ trợ **9Router** và **OpenAI trực tiếp**.
- Với 9Router, Side Panel có thể lấy danh sách model từ backend và cho bạn chọn Model ID.
- API key nằm ở backend, **không nằm trong extension**.

## 1. Cấu hình 9Router

Bản 1.1 mặc định dùng 9Router theo chuẩn OpenAI-compatible.

9Router local thường expose API tại:

```text
http://127.0.0.1:20128/v1
```

Hãy chạy/cấu hình 9Router trước, sau đó lấy API key trong dashboard của 9Router.

## 2. Chạy backend

Yêu cầu: Node.js 20.6+.

### Windows PowerShell

```powershell
cd backend
Copy-Item .env.example .env
notepad .env
npm start
```

### macOS / Linux

```bash
cd backend
cp .env.example .env
# sửa .env
npm start
```

Ví dụ `.env` dùng 9Router local:

```env
AI_PROVIDER=9router
AI_BASE_URL=http://127.0.0.1:20128/v1
AI_API_KEY=your-api-key-from-9router-dashboard
AI_MODEL=if/glm-4.7
PORT=8787
```

`AI_MODEL` chỉ là model mặc định. Model nào dùng được phụ thuộc các provider/account bạn đã kết nối trong 9Router. Bạn có thể đổi model ngay trong ⚙ của Side Panel.

Nếu muốn chặn người dùng chọn model tuỳ ý:

```env
ALLOWED_MODELS=if/glm-4.7,cc/claude-opus-4-6
```

Để trống `ALLOWED_MODELS` thì backend chấp nhận Model ID gửi từ Side Panel.

Sau khi chạy, terminal sẽ hiện dạng:

```text
AI Study Sidekick backend: http://localhost:8787
Provider: 9router
Base URL: http://127.0.0.1:20128/v1
```

Kiểm tra:

```text
http://localhost:8787/health
```

## 3. Cài extension vào Chrome

1. Mở `chrome://extensions`.
2. Bật **Developer mode**.
3. Chọn **Load unpacked**.
4. Chọn thư mục `extension` trong project này.
5. Ghim icon **AI Study Sidekick** lên toolbar nếu muốn.
6. Bấm icon extension để mở Side Panel.

## 4. Chọn model 9Router

1. Mở Side Panel → bấm **⚙**.
2. Backend URL giữ `http://localhost:8787` nếu backend chạy local.
3. Bấm **Kiểm tra kết nối**.
4. Bấm nút **↻** cạnh Model ID để gọi danh sách model từ 9Router.
5. Chọn/nhập Model ID rồi bấm **Lưu**.

Extension gửi `model` cho backend; API key vẫn chỉ nằm ở server.

## 5. Dùng 9Router Cloud

Nếu tài khoản/cấu hình của bạn dùng endpoint cloud, đổi `.env`, ví dụ:

```env
AI_PROVIDER=9router
AI_BASE_URL=https://9router.com/v1
AI_API_KEY=your-api-key
AI_MODEL=your-model-id
```

Sau đó restart backend.

## 6. Quay lại OpenAI trực tiếp

```env
AI_PROVIDER=openai
AI_BASE_URL=https://api.openai.com/v1
AI_API_KEY=sk-your-openai-key
AI_MODEL=gpt-5
PORT=8787
```

Backend sẽ dùng OpenAI Responses API khi `AI_PROVIDER=openai`.

## 7. Sử dụng

- Mở một website bình thường (`http` / `https`).
- Bôi đen một đoạn text → panel sẽ nhận đoạn đang chọn.
- Hoặc chuột phải → **Hỏi AI về đoạn đã chọn**.
- Khi lưu từ, extension sẽ gọi AI để dịch sang tiếng Việt và hiển thị bản dịch trong danh sách **Saved words**.
- Mỗi section lưu riêng context trang gần nhất (URL, tiêu đề, nội dung và đoạn được chọn) để khi mở lại có thể tiếp tục học đúng ngữ cảnh.
- Dùng các nút nhanh hoặc gõ câu hỏi.
- Checkbox **Dùng nội dung trang** quyết định có gửi context của trang lên backend hay không.

### Cài đặt phím tắt

Mở **⚙ → Panel shortcuts**, bấm vào ô tương ứng rồi nhấn tổ hợp phím muốn dùng. Bấm **Save** để lưu; **Reset defaults** khôi phục phím mặc định. Các phím tắt này hoạt động khi Side Panel đang mở (không áp dụng lúc đang nhập văn bản).

Phím tắt chạy toàn cục của Chrome (mở panel, lưu từ, hỏi AI, tóm tắt trang) được thay đổi tại `chrome://extensions/shortcuts`.

## 8. Backend API

### `GET /health`

Trả provider, base URL và model mặc định.

### `GET /models`

Khi provider là 9Router, backend gọi endpoint `/v1/models` của 9Router và trả danh sách Model ID cho Side Panel.

### `POST /chat`

Payload dạng:

```json
{
  "messages": [
    { "role": "user", "content": "Giải thích đoạn này" }
  ],
  "context": {
    "title": "...",
    "url": "...",
    "selection": "...",
    "pageText": "..."
  },
  "model": "if/glm-4.7"
}
```

`POST /api/words` nhận thêm trường `translation` để lưu bản dịch tiếng Việt cùng với từ.

Với 9Router, backend chuyển yêu cầu sang OpenAI-compatible `chat/completions`.

## 9. Bảo mật / production

Bản này là prototype chạy được. Nếu phát hành cho nhiều người dùng, nên bổ sung:

- Xác thực người dùng trước khi gọi backend.
- Rate limit và quota.
- Thiết lập `ALLOWED_MODELS` để tránh dùng model ngoài dự kiến.
- Chỉ cho phép origin/domain phù hợp ở CORS.
- Logging tối thiểu, không log nội dung nhạy cảm.
- Giới hạn context gửi lên model.
- Chính sách quyền riêng tư nếu phát hành Chrome Web Store.

## Cấu trúc

```text
ai-study-sidekick/
├── extension/
│   ├── manifest.json
│   ├── background.js
│   ├── content.js
│   ├── sidepanel.html
│   ├── sidepanel.css
│   ├── sidepanel.js
│   └── icons/
├── backend/
│   ├── server.mjs
│   ├── package.json
│   └── .env.example
└── README.md
```
