/**
 * ============================================================
 * PIXELDESIGN CRM — Cấu hình tập trung
 * ============================================================
 * Chỉnh sửa file này khi cần thay đổi cấu hình kết nối.
 * KHÔNG commit file này lên repository công khai.
 * ============================================================
 */

const CONFIG = {

  // ──────────────────────────────────────────────────────────
  // GOOGLE OAUTH 2.0
  // Lấy từ: console.cloud.google.com → APIs & Services → Credentials
  // ──────────────────────────────────────────────────────────
  CLIENT_ID: '692386348752-9h282jk67080lc2p6al3uqiqtci45em8.apps.googleusercontent.com',

  // ──────────────────────────────────────────────────────────
  // GOOGLE SHEETS
  // Lấy từ URL: https://docs.google.com/spreadsheets/d/[ID]/edit
  // ──────────────────────────────────────────────────────────
  SPREADSHEET_ID: '1XDzez-L2mw5jwlsoxtEUFtObrB-20vf9c5D3KEaoZ0Q',

  // ──────────────────────────────────────────────────────────
  // NƠI CHỨA ẢNH ĐÍNH KÈM TRÊN GOOGLE DRIVE
  // ──────────────────────────────────────────────────────────
  // Thư mục "ETSY" nằm trong Drive dùng chung "ETSY CLIENTS".
  // App tạo một thư mục con theo mã đơn ở đây rồi bỏ ảnh vào.
  //
  // BẮT BUỘC phải là thư mục trong DRIVE DÙNG CHUNG của công ty,
  // không phải Drive cá nhân. Để trống thì Drive sẽ đặt ảnh vào
  // gốc Drive cá nhân của người đang đăng nhập — nghỉ việc là mất.
  //
  // Đổi thư mục: mở thư mục đó trên Drive, lấy đoạn ID cuối URL
  // https://drive.google.com/drive/folders/[ID]
  DRIVE_FOLDER_ID: '1rnhUl0BzQwjjQ_6ie-Za57O7cRQ3CvmX',

  // ──────────────────────────────────────────────────────────
  // GOOGLE API SCOPES
  // Quyền truy cập được yêu cầu khi đăng nhập
  // Mỗi khi thêm/bớt scope, tăng SCOPE_VERSION lên 1
  // để app tự động xoá session cũ và yêu cầu đăng nhập lại
  // ──────────────────────────────────────────────────────────
  SCOPES: [
    'https://www.googleapis.com/auth/spreadsheets', // Đọc + ghi Google Sheets
    'https://www.googleapis.com/auth/drive.file',   // Upload ảnh lên Google Drive
    'profile',                                       // Tên, ảnh đại diện
    'email',                                         // Địa chỉ email
  ].join(' '),

  // Tăng số này mỗi khi thay đổi SCOPES để buộc re-auth
  SCOPE_VERSION: 2,

  // ──────────────────────────────────────────────────────────
  // TÊN CÁC TAB TRONG GOOGLE SHEETS
  // Phải khớp chính xác với tên tab trong file Sheets
  // ──────────────────────────────────────────────────────────
  SHEETS: {
    DON_HANG:       'DON_ETSY',
    DIEM_DESIGNER:  'DIEM_DESIGNER_ETSY',
    NHAN_SU:        'NHAN_SU',
    COMMENT:        'COMMENT_ETSY',
    DANH_MUC_SHOP:  'DANH_MUC_SHOP',
    DANH_MUC_LOAI:  'DANH_MUC_LOAI',
  },

  // ──────────────────────────────────────────────────────────
  // VAI TRÒ NGƯỜI DÙNG
  // Phải khớp với giá trị cột "vai_tro" trong tab NHAN_SU
  // ──────────────────────────────────────────────────────────
  ROLES: {
    ADMIN:    'admin',
    SALE:     'sale',
    DESIGNER: 'designer',
  },

  // ──────────────────────────────────────────────────────────
  // CÀI ĐẶT KHÁC
  // ──────────────────────────────────────────────────────────
  // ──────────────────────────────────────────────────────────
  // LIÊN KẾT QUAY VỀ APP PIXELDESIGN
  // Chỉ những email trong PIXEL_USERS mới thấy tab này.
  // ──────────────────────────────────────────────────────────
  PIXEL_URL: 'https://crm.pixeldesign.vn',
  PIXEL_USERS: [
    'honghoa.giameco@gmail.com',
  ],

  APP_NAME:    'PIXELDESIGN ETSY',
  APP_VERSION: '1.0.0',

  // Thời gian session tối đa (ms) — mặc định: 1 tiếng
  // Google OAuth token thường có hiệu lực 3600 giây (1 tiếng)
  SESSION_DURATION: 60 * 60 * 1000,

};

// Đóng băng object để tránh vô tình sửa đổi trong runtime
Object.freeze(CONFIG);
Object.freeze(CONFIG.SHEETS);
Object.freeze(CONFIG.ROLES);
Object.freeze(CONFIG.PIXEL_USERS);
