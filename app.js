/**
 * ============================================================
 * PIXELDESIGN ETSY — app.js
 * ============================================================
 */

const App = {

  // ──────────────────────────────────────────────────────────
  // STATE
  // ──────────────────────────────────────────────────────────
  session:     null,
  tokenClient: null,
  currentPage: 'don-hang',
  _isSubmittingDon: false,
  _kanbanData: [],
  _kanbanRowMap: {},
  _kanbanDesignerMap: {},
  _kanbanDesignerScoreMap: {},
  _kanbanLabelMap: {},
  _kanbanKhachHangMap: {},
  _uploadFilesMap: {},
  KANBAN_COLS: ['Chờ thông tin', 'Đơn mới', 'Gửi khách hàng', 'Cần chỉnh sửa', 'Hoàn thành'],

  // ──────────────────────────────────────────────────────────
  // BOOTSTRAP
  // ──────────────────────────────────────────────────────────

  init() {
    this.session = this._loadSession();
    // Kiểm tra session còn hạn VÀ đúng scope version
    // Nếu scopes đã thay đổi (SCOPE_VERSION tăng), buộc đăng nhập lại
    // để lấy token mới với đủ quyền truy cập
    const scopeOk = (this.session?.scopeVersion ?? this.session?.version) === CONFIG.SCOPE_VERSION;

    if (this.session && !this._isTokenExpired() && scopeOk) {
      console.log('[Auth] Session còn hạn và đúng scope version, bỏ qua đăng nhập.');
      this._batDauGiuPhien();
      this._renderApp();
    } else {
      if (this.session && !scopeOk) {
        console.log(`[Auth] Scope version cũ (${this.session?.scopeVersion}) < hiện tại (${CONFIG.SCOPE_VERSION}). Xoá session, yêu cầu đăng nhập lại.`);
      }
      this._clearSession();
      this._showLogin();
      this._initGoogleTokenClient();
    }
  },

  _initGoogleTokenClient() {
    if (!google?.accounts?.oauth2) return;
    this.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.CLIENT_ID,
      scope: CONFIG.SCOPES,
      callback: (tokenResponse) => {
        // Co token moi ve bang BAT KY duong nao -> go tam che "Phien da het han".
        try {
          if (tokenResponse?.access_token) document.getElementById('lop-phien-het')?.remove();
        } catch (e) {}
        // ── LAM MOI NGAM phai xu ly TRUOC khi bao loi, neu khong loi se lam
        //    ham cho token treo den khi het 20 giay.
        if (this._dangLamMoiNgam) {
          const xong = this._dangLamMoiNgam;
          this._dangLamMoiNgam = null;
          if (tokenResponse.error || !tokenResponse.access_token) {
            console.warn('[Auth] Làm mới phiên thất bại:', tokenResponse.error || 'không có token');
            xong(false);
            return;
          }
          const hanMoi2 = Date.now() + ((parseInt(tokenResponse.expires_in) || 3600) * 1000);
          this.session = { ...this.session,
            accessToken: tokenResponse.access_token,
            expiresAt: hanMoi2, tokenExpiry: hanMoi2 };
          localStorage.setItem('pixeldesign_session', JSON.stringify(this.session));
          console.log('[Auth] Đã làm mới phiên ngầm, hạn mới:', new Date(hanMoi2).toLocaleTimeString('vi-VN'));
          xong(true);
          return;
        }

        if (tokenResponse.error) {
          console.error(tokenResponse);
          this.showToast('Lỗi đăng nhập', 'error');
          return;
        }

        // LUU Y: truoc day chi luu expiresAt/version, trong khi init() lai kiem
        // tokenExpiry/scopeVersion -> luon coi la het han -> moi lan mo app deu
        // bat dang nhap lai. Nay luu CA HAI ten cho khop.
        const hanToken = Date.now() + ((parseInt(tokenResponse.expires_in) || 3600) * 1000);
        this.session = {
          ...(this.session || {}),
          accessToken: tokenResponse.access_token,
          expiresAt:    hanToken,
          tokenExpiry:  hanToken,
          version:      CONFIG.SCOPE_VERSION,
          scopeVersion: CONFIG.SCOPE_VERSION
        };
        localStorage.setItem('pixeldesign_session', JSON.stringify(this.session));
        this._batDauGiuPhien();
        this._checkSession();
      }
    });
    this._checkSession();
  },

  _loadSession() {
    try {
      const data = localStorage.getItem('pixeldesign_session');
      if (!data) return null;
      return JSON.parse(data);
    } catch(e) { return null; }
  },

  _checkSession() {
    const hanSession = this.session?.tokenExpiry || this.session?.expiresAt || 0;
    const phienBanScope = this.session?.scopeVersion ?? this.session?.version;
    if (this.session && hanSession > Date.now() && phienBanScope === CONFIG.SCOPE_VERSION) {
      document.getElementById('login-screen').classList.add('hidden');
      document.getElementById('app-shell').classList.remove('hidden');
      this._fetchUserProfile();
      this.navigateTo(this.currentPage);
    } else {
      document.getElementById('login-screen').classList.remove('hidden');
      document.getElementById('app-shell').classList.add('hidden');
    }
  },

  signIn() {
    if (!this.tokenClient) {
      // GSI script chưa load xong, thử khởi tạo lại
      this._initGoogleTokenClient();
      if (!this.tokenClient) {
        this._showLoginError('Google Script chưa sẵn sàng. Vui lòng thử lại sau giây lát.');
        return;
      }
    }
    this._hideLoginError();
    this.tokenClient.requestAccessToken();
  },

  signOut() {
    if (this.session?.accessToken) {
      try {
        google.accounts.oauth2.revoke(this.session.accessToken, () => {
          console.log('[Auth] Token đã được thu hồi.');
        });
      } catch (e) {
        // Ignore nếu token đã hết hạn
      }
    }
    this._clearSession();
    this.tokenClient = null;

    // Reset UI
    document.getElementById('app-shell').classList.add('hidden');
    this._showLogin();
    this._resetLoginButton();
    this._hideLoginError();
    this._initGoogleTokenClient();
  },

  async _fetchUserProfile() {
    if (!this.session?.accessToken) return;
    try {
      const res = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${this.session.accessToken}` }
      });
      const profile = await res.json();
      if (profile.error) throw new Error(profile.error.message);
      
      this.session.profile = profile;
      this.session.email = profile.email;   // dung lam "hint" khi gia han phien
      document.getElementById('user-name').innerText = profile.name || profile.email;
      
      const rows = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.NHAN_SU);
      if (rows && rows.length > 0) {
        const user = rows.find(r => r.email === profile.email);
        const vaiTro = user ? user.vai_tro : 'viewer';
        document.getElementById('user-role').innerText = vaiTro;
        this.session.role = vaiTro;
        localStorage.setItem('pixeldesign_session', JSON.stringify(this.session));
        this._applyRolePermissions(vaiTro);
        
        if (vaiTro === 'designer' && this.currentPage === 'don-hang') {
          this.navigateTo('kanban');
        }
      }
    } catch (e) {
      console.error(e);
      document.getElementById('user-name').innerText = 'Lỗi tải profile';
    }
  },

  _applyRolePermissions(role) {
    document.querySelectorAll('[data-role="admin"]').forEach(el => {
      const isVisible = (role === 'admin');
      el.style.display = isVisible ? '' : 'none';
    });
    document.querySelectorAll('[data-role="admin-sale"]').forEach(el => {
      const isVisible = (role === 'admin' || role === 'sale');
      el.style.display = isVisible ? '' : 'none';
    });
    // Tab quay ve app PIXEL: chi nhung email khai trong CONFIG.PIXEL_USERS
    const myEmail = (this.session?.email || '').toLowerCase().trim();
    const pixelList = (CONFIG.PIXEL_USERS || []).map(e => (e || '').toLowerCase().trim());
    document.querySelectorAll('[data-role="pixel"]').forEach(el => {
      el.style.display = pixelList.includes(myEmail) ? '' : 'none';
    });
  },

  navigateTo(page) {
    this.currentPage = page;
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItem = document.getElementById('nav-' + page);
    if (navItem) navItem.classList.add('active');
    
    const titleEl = document.getElementById('page-title');
    const subtitleEl = document.getElementById('page-subtitle');
    const content = document.getElementById('page-content');
    
    if (page === 'don-hang') {
        if(titleEl) titleEl.innerText = 'Lên đơn';
        if(subtitleEl) subtitleEl.innerText = 'Tạo và quản lý đơn hàng mới';
        if (content) content.innerHTML = '';
        if(this.renderDonHangPage) this.renderDonHangPage();
    } else if (page === 'kanban') {
        if(titleEl) titleEl.innerText = 'Kanban';
        if(subtitleEl) subtitleEl.innerText = 'Theo dõi tiến độ công việc theo cột';
        if (content) content.innerHTML = '';
        if(this.renderKanbanPage) this.renderKanbanPage();
    }
  },
  
  showUserMenu(event) {
    if(event) event.stopPropagation();
  },

  // ── Utils ──
  showToast(msg, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  },

  _setLoadingState(btn, isLoading, originalText = '') {
    if (!btn) return;
    if (isLoading) {
      btn.dataset.originalText = btn.innerHTML;
      btn.innerHTML = '<span class="spinner"></span> Đang tải...';
      btn.disabled = true;
    } else {
      btn.innerHTML = btn.dataset.originalText || originalText;
      btn.disabled = false;
    }
  },

  _showLoading() {},
  _hideLoading() {},
  
  _escHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  },
  
  _formatDateToday() {
    const now = new Date();
    const d = String(now.getDate()).padStart(2, '0');
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const y = now.getFullYear();
    return `${d}/${m}/${y}`;
  },
  
  _datLaiForm() {
    const f = document.getElementById('form-len-don');
    if (f) f.reset();
  },

  async _getDropdownData(sheetName, type) {
    try {
        const rows = await this._readSheet(this.session?.accessToken, sheetName);
        if (!rows || rows.length === 0) return [];
        
        if (type === 'shop' && rows[0].ten_shop) {
            return rows.map(r => r.ten_shop).filter(v => v);
        } else if (type === 'loai' && rows[0].ten_loai) {
            return rows.map(r => r.ten_loai).filter(v => v);
        }
        
        return rows.map(r => Object.values(r)[0]).filter(v => v);
    } catch(e) {
        console.warn('Lỗi lấy dropdown', type, e);
        if (type === 'shop') return ['Apollo', 'Jolie', 'WAT'];
        if (type === 'loai') return ['Collage', 'Poster Custom', 'Instant', 'Template'];
        return [];
    }
  },

  async _readSheet(token, sheetName, range = '', laLanThu2 = false) {
    // Bao dam token con song truoc khi goi
    if (!token) await this._baoDamConPhien();
    const tk = token || this.session?.accessToken;
    if (!tk) throw new Error('No token');

    const rangeParam = range ? `${sheetName}!${range}` : sheetName;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(rangeParam)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${tk}` } });

    // 401 = token het han -> lam moi ngam roi THU LAI MOT LAN
    if (res.status === 401 && !laLanThu2) {
      console.warn('[Auth] Sheets trả 401, thử làm mới phiên rồi gọi lại...');
      const ok = await this._lamMoiPhienNgam();
      if (ok) return this._readSheet(null, sheetName, range, true);
      this._phienDaHet();
      throw new Error('Phiên đăng nhập đã hết hạn.');
    }

    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return this._parseSheet(data.values || []);
  },

  async _writeSheet(sheetName, range, values) {
    const token = this.session?.accessToken;
    if (!token) throw new Error('No token');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(sheetName + '!' + range)}?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  },

  async _appendSheet(sheetName, values) {
    const token = this.session?.accessToken;
    if (!token) throw new Error('No token');
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(sheetName)}:append?valueInputOption=USER_ENTERED`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    return data;
  },

  _setupUploadZone(id) {},
  _renderUploadPreview(id) {},
  async _uploadPendingFiles(id) { return []; },
  

  /**
   * Chuyển mảng 2 chiều từ Sheets API thành mảng object.
   * Hàng đầu tiên là tên cột.
   */
  _parseSheet(values) {
    if (!values || values.length < 1) return [];
    const headers = values[0];
    if (values.length < 2) return [];
    return values.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        obj[h.trim()] = (row[i] !== undefined) ? String(row[i]).trim() : '';
      });
      return obj;
    });
  },

  /**
   * Tìm nhân sự theo email (case-insensitive).
   */
  _findByEmail(list, email) {
    const target = (email || '').toLowerCase().trim();
    return list.find(r => (r.email || '').toLowerCase().trim() === target) || null;
  },


  // ──────────────────────────────────────────────────────────
  // UI: APP RENDER
  // ──────────────────────────────────────────────────────────

  /**
   * Render toàn bộ app sau khi xác thực xong.
   */
  async _renderApp() {
    const { name, picture, role } = this.session;

    // Ẩn login, hiện app
    document.getElementById('login-screen').classList.add('hidden');
    document.getElementById('app-shell').classList.remove('hidden');

    // Avatar
    const avatarEl = document.getElementById('user-avatar');
    const defaultIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:20px;height:20px;color:#fff;"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
    if (picture) {
      avatarEl.innerHTML = `<img src="${picture}" alt="${this._escHtml(name)}" referrerpolicy="no-referrer" onerror="this.outerHTML='${defaultIcon.replace(/'/g, "\\'")}'" />`;
    } else {
      avatarEl.innerHTML = defaultIcon;
    }

    // Tên & vai trò
    document.getElementById('user-name').textContent = name;
    document.getElementById('user-role').innerHTML   = this._buildRoleChip(role);

    // Áp dụng phân quyền menu
    this._applyRolePermissions(role);

    // Init token client cho những lần sau (token refresh)
    if (!this.tokenClient) this._initGoogleTokenClient();

    // Điều hướng đến trang mặc định
    if (role === CONFIG.ROLES.DESIGNER) {
      this.navigateTo('kanban');
    } else {
      this.navigateTo('don-hang');
    }
    this._showToast(`Chào mừng trở lại, ${name.split(' ').pop()}! 👋`, 'success');
  },

  /**
   * Ẩn/hiện các mục menu theo vai trò.
   * Các element có `data-role="admin"` chỉ admin mới thấy.
   */
  _applyRolePermissions_legacy(role) {
    // Moved to the top class implementation
  },

  /**
   * Build HTML badge vai trò.
   */
  _buildRoleChip(role) {
    const labels = {
      admin:    '👑 Admin',
      sale:     '💼 Sale',
      designer: '🎨 Designer',
    };
    return `<span class="role-chip ${role}">${labels[role] || role}</span>`;
  },


  // ──────────────────────────────────────────────────────────
  // UI: LOGIN SCREEN
  // ──────────────────────────────────────────────────────────

  _showLogin() {
    document.getElementById('login-screen').classList.remove('hidden');
    document.getElementById('app-shell').classList.add('hidden');
  },

  _setLoginLoading(msg) {
    const btn = document.getElementById('login-btn');
    if (!btn) return;
    btn.disabled = true;
    btn.innerHTML = `<span class="spinner"></span> ${this._escHtml(msg)}`;
  },

  _resetLoginButton() {
    const btn = document.getElementById('login-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = `
      <svg viewBox="0 0 24 24" class="google-icon">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
      </svg>
      Đăng nhập với Google`;
  },

  _showLoginError(msg) {
    const el = document.getElementById('login-error');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    el.style.animation = 'none';
    el.offsetHeight; // reflow
    el.style.animation = '';
  },

  _hideLoginError() {
    const el = document.getElementById('login-error');
    if (el) el.classList.add('hidden');
  },


  // ──────────────────────────────────────────────────────────
  // UI: TOAST
  // ──────────────────────────────────────────────────────────

  _showToast(msg, type = 'info', duration = 3500) {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity    = '0';
      toast.style.transform  = 'translateX(20px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },


  // ──────────────────────────────────────────────────────────
  // SESSION MANAGEMENT
  // ──────────────────────────────────────────────────────────

  _saveSession(session) {
    try {
      localStorage.setItem('pixeldesign_session', JSON.stringify(session));
      this.session = session;
    } catch (e) {
      console.error('[Session] Không thể lưu session:', e);
    }
  },

  _loadSession() {
    try {
      const raw = localStorage.getItem('pixeldesign_session');
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  },

  _clearSession() {
    try { localStorage.removeItem('pixeldesign_session'); } catch (_) {}
    this.session = null;
  },

  _isTokenExpired() {
    // Chap nhan ca hai ten truong: ban cu luu expiresAt, ban moi luu tokenExpiry
    const han = this.session?.tokenExpiry || this.session?.expiresAt;
    if (!han) return true;
    return Date.now() >= (han - 60_000);   // tru 60 giay de khong het han giua chung
  },

  // ──────────────────────────────────────────────────────────
  // GIU PHIEN DANG NHAP — tu gia han, khong bat dang nhap lai
  // ──────────────────────────────────────────────────────────

  async _lamMoiPhienNgam(imLang = true) {
    if (this._huaLamMoi) return this._huaLamMoi;

    this._huaLamMoi = new Promise((resolve) => {
      if (!this.tokenClient) this._initGoogleTokenClient();
      if (!this.tokenClient) { resolve(false); return; }

      let daXong = false;
      const xong = (ok) => { if (!daXong) { daXong = true; resolve(ok); } };
      this._dangLamMoiNgam = xong;

      try {
        // imLang=true  -> prompt:'' : khong hien gi (may tinh, Android)
        // imLang=false -> cho Google hien giao dien. CHI goi khi nguoi dung
        //                 vua CHAM, vi iOS chan cua so bat len neu khong co cu cham.
        const xinToken = imLang ? { prompt: '' } : {};
        const mail = this.session?.profile?.email || this.session?.email;
        if (mail) xinToken.hint = mail;
        this.tokenClient.requestAccessToken(xinToken);
      } catch (e) {
        console.warn('[Auth] Không gọi được làm mới ngầm:', e.message);
        this._dangLamMoiNgam = null;
        xong(false);
      }
      // Im lang thi 20 giay la du. Nhung khi NGUOI DUNG tu cham nut, ho con phai
      // doc va chon tai khoan Google — 20 giay qua ngan. Het gio som se bao loi
      // oan, dong thoi lam token ve sau bi lac sang luong dang nhap moi.
      const hanCho = imLang ? 20000 : 5 * 60 * 1000;
      setTimeout(() => { this._dangLamMoiNgam = null; xong(false); }, hanCho);
    }).finally(() => { this._huaLamMoi = null; });

    return this._huaLamMoi;
  },

  async _baoDamConPhien() {
    if (!this._isTokenExpired()) return true;
    return await this._lamMoiPhienNgam();
  },

  /**
   * Phien het han. KHONG xoa session, KHONG da ra man dang nhap.
   * Hien mot lop phu ngay tren man dang xem, co nut de nguoi dung CHAM.
   * Cu cham do la thu iOS bat buoc phai co thi moi cho mo cua so Google.
   */
  _phienDaHet() {
    console.warn('[Auth] Phiên đã hết. Hiện bảng đăng nhập lại tại chỗ.');
    if (document.getElementById('lop-phien-het')) return;   // da hien roi

    const lop = document.createElement('div');
    lop.id = 'lop-phien-het';
    lop.style.cssText = 'position:fixed; inset:0; z-index:99999; display:flex;' +
      'align-items:center; justify-content:center; padding:24px;' +
      'background:rgba(43,35,24,0.55); backdrop-filter:blur(3px);';
    lop.innerHTML =
      '<div style="background:#FDFBF7; border-radius:18px; max-width:380px; width:100%;' +
      'padding:28px 24px; text-align:center; box-shadow:0 12px 40px rgba(0,0,0,0.28);">' +
        '<div style="font-size:38px; line-height:1; margin-bottom:14px;">🔒</div>' +
        '<div style="font-size:17px; font-weight:800; color:#2B2318; margin-bottom:8px;">' +
          'Phiên đăng nhập đã hết hạn</div>' +
        '<div style="font-size:13.5px; color:#6B5F52; line-height:1.6; margin-bottom:20px;">' +
          'Chạm nút bên dưới để tiếp tục. Bạn sẽ quay lại đúng màn hình đang xem, ' +
          'không mất dữ liệu nào.</div>' +
        '<button type="button" id="nut-dang-nhap-lai" ' +
          'style="width:100%; border:none; cursor:pointer; background:#8A724C; color:#fff;' +
          'font-size:15px; font-weight:700; padding:14px; border-radius:12px;">' +
          'Đăng nhập lại</button>' +
        '<div id="loi-dang-nhap-lai" style="font-size:12.5px; color:#B4453C; margin-top:12px; min-height:16px;"></div>' +
      '</div>';
    document.body.appendChild(lop);
    document.getElementById('nut-dang-nhap-lai')
      .addEventListener('click', () => this._dangNhapLaiTaiCho());
  },

  /**
   * Chay khi nguoi dung CHAM nut. Vi co cu cham nen iOS cho mo cua so Google.
   */
  async _dangNhapLaiTaiCho() {
    const nut  = document.getElementById('nut-dang-nhap-lai');
    const oLoi = document.getElementById('loi-dang-nhap-lai');
    // Huy lan cho cu (neu co) de moi lan cham la mot lan thu MOI thuc su,
    // khong bi ket vao lan cho truoc do.
    if (this._dangLamMoiNgam) {
      const cu = this._dangLamMoiNgam;
      this._dangLamMoiNgam = null;
      try { cu(false); } catch (e) {}
    }
    this._huaLamMoi = null;

    if (nut)  { nut.disabled = true; nut.textContent = 'Đang mở Google...'; }
    if (oLoi) oLoi.textContent = '';

    // Khi nguoi dung quay lai app (dong cua so Google, hoac chon xong tai khoan),
    // mo khoa nut de ho co the cham lai neu can. Khong cho du 5 phut.
    const moKhoaNut = () => {
      if (document.hidden) return;
      const n = document.getElementById('nut-dang-nhap-lai');
      if (n && n.disabled) { n.disabled = false; n.textContent = 'Thử lại'; }
    };
    document.addEventListener('visibilitychange', moKhoaNut);

    let ok = false;
    try { ok = await this._lamMoiPhienNgam(false); }   // false = cho Google hien giao dien
    finally { document.removeEventListener('visibilitychange', moKhoaNut); }

    if (ok) {
      document.getElementById('lop-phien-het')?.remove();
      try { if (this.currentPage) this.navigateTo(this.currentPage); } catch (e) {}
      try { (this._showToast || this.showToast)?.call(this, 'Đã kết nối lại', 'success', 2000); } catch (e) {}
      return;
    }

    if (nut)  { nut.disabled = false; nut.textContent = 'Thử lại'; }
    if (oLoi) oLoi.textContent = 'Chưa kết nối được. Chạm "Thử lại", hoặc mở app bằng trình duyệt Safari thay vì icon màn hình chính.';
  },

  _batDauGiuPhien() {
    if (this._daBatGiuPhien) return;
    this._daBatGiuPhien = true;

    setInterval(async () => {
      if (!this.session?.accessToken) return;
      if (document.hidden) return;
      if (this._isTokenExpired()) await this._lamMoiPhienNgam();
    }, 4 * 60 * 1000);

    // iPad/iPhone dong bang tab -> hen gio ngung chay. Quay lai phai kiem NGAY.
    document.addEventListener('visibilitychange', async () => {
      if (document.hidden) return;
      if (!this.session?.accessToken) return;
      if (!this._isTokenExpired()) return;
      const ok = await this._lamMoiPhienNgam();
      if (!ok) this._phienDaHet();
    });
  },


  // ──────────────────────────────────────────────────────────
  // UTILITIES
  // ──────────────────────────────────────────────────────────

  /** Escape HTML để tránh XSS */
  _escHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  },


  // ════════════════════════════════════════════════════════════
  // MODULE: LÊN ĐƠN
  // ════════════════════════════════════════════════════════════

  async renderDonHangPage() {
    const container = document.getElementById('page-content');
    const actions = document.getElementById('page-actions');
    actions.innerHTML = '';

    const shopList = await this._getDropdownData(CONFIG.SHEETS.DANH_MUC_SHOP, 'shop');
    const loaiList = await this._getDropdownData(CONFIG.SHEETS.DANH_MUC_LOAI, 'loai');

    const shopOpts = shopList.map(s => `<option value="${this._escHtml(s)}">${this._escHtml(s)}</option>`).join('');
    const loaiOpts = loaiList.map(l => `<option value="${this._escHtml(l)}">${this._escHtml(l)}</option>`).join('');

    container.innerHTML = `
    <form id="form-len-don" class="len-don-form" style="max-width: 900px; margin: 0 auto;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px;">
        <div class="form-group">
          <label class="form-label" for="ma_order_etsy">Mã order Etsy <span class="required">*</span></label>
          <input type="text" class="form-input" id="ma_order_etsy" required placeholder="VD: 4139022512" />
        </div>
        <div class="form-group">
          <label class="form-label" for="turnaround">Turnaround (Hạn xử lý)</label>
          <select class="form-select" id="turnaround">
            <option value="">Chọn turnaround</option>
            <option value="12h">12h</option>
            <option value="24h">24h</option>
            <option value="36h">36h</option>
            <option value="48h">48h</option>
            <option value="3 days">3 days</option>
            <option value="4 days">4 days</option>
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="shop">Shop</label>
          <select class="form-select" id="shop">
            <option value="">Chọn Shop</option>
            ${shopOpts}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="loai">Loại</label>
          <select class="form-select" id="loai">
            <option value="">Chọn Loại</option>
            ${loaiOpts}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label" for="buyer_name">Tên người mua <span class="required">*</span></label>
          <input type="text" class="form-input" id="buyer_name" required placeholder="Tên khách hàng" />
        </div>
        <div class="form-group">
          <label class="form-label" for="buyer_email">Email người mua</label>
          <input type="email" class="form-input" id="buyer_email" placeholder="email@example.com" />
        </div>
      </div>
      
      <div class="form-group" style="margin-top:16px;">
        <label class="form-label" for="item_name">Item Name <span class="required">*</span></label>
        <input type="text" class="form-input" id="item_name" required placeholder="Tên sản phẩm" />
      </div>

      <div class="form-group" style="margin-top:16px;">
        <label class="form-label" for="personalization">Personalization</label>
        <textarea class="form-input" id="personalization" rows="6" placeholder="Yêu cầu của khách hàng..."></textarea>
      </div>
      
      <div class="form-group" style="margin-top:16px;">
        <label class="form-label" for="link_anh_kh">Link ảnh khách gửi</label>
        <input type="text" class="form-input" id="link_anh_kh" placeholder="Google Drive, Dropbox..." />
      </div>
      
      <div class="form-group" style="margin-top:16px;">
        <label class="form-label" for="cot_kanban">Trạng thái ban đầu</label>
        <select class="form-select" id="cot_kanban">
          <option value="Đơn mới" selected>Đơn mới</option>
          <option value="Chờ thông tin">Chờ thông tin</option>
        </select>
      </div>
      
      <div class="form-group" style="margin-top:16px;">
        <label class="form-label" for="noi_dung_email">Nội dung email trả lời</label>
        <textarea class="form-input" id="noi_dung_email" rows="10" placeholder="Nội dung email gửi cho khách..."></textarea>
      </div>
      
      <!-- ── Ảnh đính kèm ── -->
      <div class="form-section-card" style="margin-top: 20px;">
        <div class="form-section-header">
          <div class="form-section-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg></div>
          <div><div class="form-section-title">File đính kèm</div><div class="form-section-subtitle">Ảnh tham khảo, brief, mood board — upload lên Google Drive</div></div>
        </div>
        <div class="upload-zone" id="upload-zone">
          <input type="file" id="file-input-len-don" multiple style="display:none;" onchange="App._onFileSelected(this)" />
          <div class="upload-zone-icon"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg></div>
          <p><strong>Click để chọn file</strong> hoặc kéo thả vào đây<br/><small>Hỗ trợ MỌI ĐỊNH DẠNG (Ảnh, PDF, Word, ZIP, PSD...) · Tối đa 20 file</small></p>
        </div>
        <div id="upload-preview-grid" class="upload-preview-grid"></div>
        <div id="upload-progress-container" style="display:none;margin-top:12px;">
          <div class="upload-progress-bar"><div class="upload-progress-fill" id="upload-progress-fill" style="width:0%"></div></div>
          <p class="upload-status-text" id="upload-status-text">Đang chuẩn bị...</p>
        </div>
      </div>

      <div class="form-actions" style="margin-top:24px; display:flex; justify-content:flex-end; gap:12px;">
        <button type="button" class="btn btn-secondary" onclick="App._datLaiForm()">Nhập lại</button>
        <button type="submit" class="btn btn-primary" id="btn-submit-don">
          <span class="btn-text">Lưu đơn hàng</span>
        </button>
      </div>
    </form>
    `;

    this._setupUploadDragDrop();

    const form = document.getElementById('form-len-don');
    form.addEventListener('submit', (e) => this.submitDonHang(e));
    
    const loaiEl = document.getElementById('loai');
    loaiEl.addEventListener('change', () => {
      const isInstant = loaiEl.value === 'Instant' || loaiEl.value === 'Template';
      const display = isInstant ? 'none' : 'block';
      
      const emailGroup = document.getElementById('buyer_email')?.closest('.form-group');
      const turnaroundGroup = document.getElementById('turnaround')?.closest('.form-group');
      const persGroup = document.getElementById('personalization')?.closest('.form-group');
      const linkAnhGroup = document.getElementById('link_anh_kh')?.closest('.form-group');
      const kanbanGroup = document.getElementById('cot_kanban')?.closest('.form-group');
      const noiDungGroup = document.getElementById('noi_dung_email')?.closest('.form-group');
      const uploadCard = document.getElementById('upload-zone')?.closest('.form-section-card');

      if (emailGroup) emailGroup.style.display = display;
      if (turnaroundGroup) turnaroundGroup.style.display = display;
      if (persGroup) persGroup.style.display = display;
      if (linkAnhGroup) linkAnhGroup.style.display = display;
      if (kanbanGroup) kanbanGroup.style.display = display;
      if (noiDungGroup) noiDungGroup.style.display = display;
      if (uploadCard) uploadCard.style.display = display;
    });

    // Auto template logic
    form.addEventListener('input', () => {
        const shop = document.getElementById('shop').value;
        const loai = document.getElementById('loai').value;
        const email = document.getElementById('buyer_email').value.trim();
        const ma_order = document.getElementById('ma_order_etsy').value.trim();
        const ten_khach = document.getElementById('buyer_name').value.trim();
        const noi_dung = document.getElementById('noi_dung_email');
        
                const getTemplate = () => {
            let size = "16x20";
            const pers = document.getElementById('personalization').value;
            const sizeMatch = pers.match(/size\s*:?\s*(\d+\s*x\s*\d+)\s*(?:inch|in)?/i) || pers.match(/(\d+\s*x\s*\d+)\s*(?:inch|in)?/i);
            if (sizeMatch) {
                size = sizeMatch[1].replace(/\s/g, '');
            }

            if (shop === 'Jolie' && loai === 'Poster Custom') {
                return `${email}\nBIRTHDAY POSTER - Order ${ma_order}\n\nHello ${ten_khach},\nI'm Jolie from JoliesArtDesign Support Team. Thank you for purchasing.\nPlease get the final product in the link below and let me know if everything is Ok. The package includes a PDF file and two JPG image files in high-resolution which are ready for printing.\nLink to download:\n\nPlease note that the final product is DIGITAL PRINTABLE FILES ONLY! No physical prints will be sent.\nDigital files are emailed to you, and you will print them out at home or at any professional printing service, like Vistaprint, Shutterfly or Walgreens for example.\nThe normal printing size for this poster is ${size} inch\nIf you need any support, please feel free to contact me.\n--\nP/S: Your feedback matters to us. If you have a moment, we'd appreciate hearing about your experience — it helps us keep improving our products and service. Thank you!\n--\nSincerely,\nJolie\nJoliesArtDesign Support Team.`;
            } else if (shop === 'Apollo' && loai === 'Collage') {
                return `${email}\nPHOTO COLLAGE - Order ${ma_order}\n\nHello ${ten_khach},\nI'm Cristina from ApolloGraphicDesign Support Team. Thank you for purchasing.\nPlease get the final product in the link below. The package includes a PDF file and two JPG image files in the same high resolution which are ready for printing.\nYou can use any of them to print at your convenience.\nLink to download:\n\nThe printing size for this collage is ${size} inch\nPlease note that the final product is DIGITAL PRINTABLE FILES ONLY! No physical prints will be sent.\nDigital files are emailed to you, and you will print them out at any professional printing service, at any time, on any material and as many as you'd like. This is much more convenient to you.\nIf you need any support, please feel free to contact me.\n--\nP/S: Your feedback matters to us. If you have a moment, we'd appreciate hearing about your experience — it helps us keep improving our products and service. Thank you!\n--\nSincerely,\nCristina\nApolloGraphicDesign Support Team.`;
            }
            return '';
        };;
        
        const newTemplate = getTemplate();
        if (noi_dung.value === (noi_dung.dataset.lastGenerated || '')) {
            noi_dung.value = newTemplate;
            noi_dung.dataset.lastGenerated = newTemplate;
        }
    });
  },

  _setupUploadDragDrop() {
    const zone = document.getElementById('upload-zone');
    if (!zone) return;
    zone.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      document.getElementById('file-input-len-don').click();
    });
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()=> zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); this._addFiles(Array.from(e.dataTransfer.files), 'len-don'); });
  },

  _setupUploadDragDropDetail() {
    const zone = document.getElementById('upload-zone-detail');
    if (!zone) return;
    zone.addEventListener('click', (e) => {
      if (e.target.closest('.remove-btn')) return;
      document.getElementById('file-input-chi-tiet').click();
    });
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', ()=> zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); this._addFiles(Array.from(e.dataTransfer.files), 'chi-tiet'); });
  },

  _onFileSelected(input, ctx = 'len-don') { this._addFiles(Array.from(input.files), ctx); input.value = ''; },

  _addFiles(newFiles, ctx = 'len-don') {
    if (!this._uploadFilesMap) this._uploadFilesMap = {};
    if (!this._uploadFilesMap[ctx]) this._uploadFilesMap[ctx] = [];
    const arr = this._uploadFilesMap[ctx];
    const max = 20, remaining = max - arr.length;
    const toAdd = newFiles.slice(0, remaining);
    if (newFiles.length > remaining) this.showToast(`Tối đa ${max} file. Chỉ thêm ${toAdd.length} file đầu.`, 'warning');
    arr.push(...toAdd);
    this._renderPreviewGrid(ctx);
  },

  _xoaAnh(index, ctx = 'len-don') { 
    if (!this._uploadFilesMap || !this._uploadFilesMap[ctx]) return; 
    this._uploadFilesMap[ctx].splice(index, 1); 
    this._renderPreviewGrid(ctx); 
  },

  _renderPreviewGrid(ctx = 'len-don') {
    const gridId = ctx === 'len-don' ? 'upload-preview-grid' : `upload-preview-grid-${ctx}`;
    const grid = document.getElementById(gridId);
    if (!grid) return;
    const arr = (this._uploadFilesMap && this._uploadFilesMap[ctx]) ? this._uploadFilesMap[ctx] : [];
    if (!arr.length) { grid.innerHTML = ''; return; }
    grid.innerHTML = arr.map((file, i) => {
      const isImg = file.type.startsWith('image/');
      const isVid = file.type.startsWith('video/');
      const isPdf = file.type === 'application/pdf';
      const isDoc = /\.(doc|docx)$/i.test(file.name);
      const isXls = /\.(xls|xlsx)$/i.test(file.name);
      const emoji = isPdf ? '📄' : isDoc ? '📝' : isXls ? '📊' : isVid ? '🎬' : '📎';
      const src   = isImg ? URL.createObjectURL(file) : '';
      const sizeMb = (file.size / 1024 / 1024).toFixed(1);
      return `<div class="upload-preview-item" style="position:relative; z-index:10;">
        ${isImg ? `<img src="${src}" alt="${this._escHtml(file.name)}" loading="lazy">` : `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:4px;"><span style="font-size:26px;">${emoji}</span><span style="font-size:9px;color:var(--clr-text-muted);">${sizeMb}MB</span></div>`}
        <div class="file-name">${this._escHtml(file.name)}</div>
        <button type="button" class="remove-btn" onclick="App._xoaAnh(${i}, '${ctx}'); event.stopPropagation();" title="Xoá">✕</button>
      </div>`;
    }).join('');
  },

  async _sinhMaDon() {
    const rows = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_ETSY || 'DON_ETSY');
    if (!rows || rows.length === 0) return 'ETSY-0001';
    let max = 0;
    rows.forEach(r => {
      const m = (r.ma_don || '').match(/ETSY-(\d+)$/);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    });
    return `ETSY-${String(max + 1).padStart(4, '0')}`;
  },



  _setUploadProgress(pct, text) {
    const fill = document.getElementById('upload-progress-fill');
    const txt  = document.getElementById('upload-status-text');
    if (fill) fill.style.width = pct + '%';
    if (txt && text) txt.textContent = text;
  },

  async _createDriveFolder(folderName, parentFolderId) {
    const meta = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: parentFolderId ? [parentFolderId] : []
    };
    const res = await fetch('https://www.googleapis.com/drive/v3/files', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.session.accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(meta)
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || `Lỗi tạo thư mục: ${res.status}`); }
    const data = await res.json();
    return data.id;
  },

  async _uploadFileDrive(file, folderId) {
    const meta = { name: file.name, parents: folderId ? [folderId] : [] };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(meta)], { type: 'application/json' }));
    form.append('file', file);
    
    const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${this.session.accessToken}` },
      body: form
    });
    if (!res.ok) { const e = await res.json().catch(()=>({})); throw new Error(e.error?.message || `Upload Drive ${res.status}`); }
    const data = await res.json();
    return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
  },

  async _uploadAnhLenDrive(files, maDon) {
    if (!files || files.length === 0) return [];
    try {
      this._setUploadProgress(5, `Đang tạo thư mục ${maDon} trên Drive...`);
      const parentId = CONFIG.DRIVE_FOLDER_ID;
      const folderId = await this._createDriveFolder(maDon, parentId);
      
      let links = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        try {
          this._setUploadProgress(10 + Math.round((i / files.length) * 85), `Đang upload (${i+1}/${files.length}): ${file.name}`);
          const link = await this._uploadFileDrive(file, folderId);
          links.push(link);
        } catch (e) {
          console.warn('[Drive] Upload lỗi:', file.name, e.message);
          links.push(`[Upload thất bại: ${file.name}]`);
        }
      }
      this._setUploadProgress(100, '✅ Upload hoàn tất!');
      return links;
    } catch (err) {
      console.error('Lỗi upload:', err);
      this._setUploadProgress(0, 'Lỗi upload Drive');
      return [];
    }
  },

  async submitDonHang(e) {
    e.preventDefault();
    if (this._isSubmittingDon) return;
    this._isSubmittingDon = true;

    const btn = document.getElementById('btn-submit-don');
    this._setLoadingState(btn, true);

    try {
      const ngay_len_don = this._formatDateToday();
      const ma_don = await this._sinhMaDon();
      
      const ma_order_etsy = document.getElementById('ma_order_etsy').value.trim();
      const shop = document.getElementById('shop').value;
      const loai = document.getElementById('loai').value;
      const isInstant = (loai === 'Instant' || loai === 'Template');
      const buyer_name = document.getElementById('buyer_name').value.trim();
      const item_name = document.getElementById('item_name').value.trim();
      
      let uploadedUrls = [];
      if (!isInstant) {
        const prog = document.getElementById('upload-progress-container');
        if (prog) prog.style.display = 'block';
        uploadedUrls = await this._uploadAnhLenDrive(this._uploadFilesMap['len-don'] || [], ma_don);
        if (prog) prog.style.display = 'none';
      }
      
      const buyer_email = isInstant ? '' : document.getElementById('buyer_email').value.trim();
      const personalization = isInstant ? '' : document.getElementById('personalization').value.trim();
      const turnaround = isInstant ? '' : document.getElementById('turnaround').value.trim();
      const cot_kanban = isInstant ? 'Hoàn thành' : (document.getElementById('cot_kanban')?.value || 'Đơn mới');
      const noi_dung_email = isInstant ? '' : document.getElementById('noi_dung_email').value.trim();
      let link_anh_kh = isInstant ? '' : document.getElementById('link_anh_kh').value.trim();

      if (uploadedUrls.length > 0) {
        const driveLinks = uploadedUrls.join('\n');
        link_anh_kh = link_anh_kh ? link_anh_kh + '\n' + driveLinks : driveLinks;
      }

      const rowData = [
        ma_don,         // 1. ma_don
        ma_order_etsy,  // 2. ma_order_etsy
        shop,           // 3. shop
        loai,           // 4. loai
        buyer_name,     // 5. buyer_name
        buyer_email,    // 6. buyer_email
        item_name,      // 7. item_name
        personalization,// 8. personalization
        link_anh_kh,    // 9. link_anh_kh
        turnaround,     // 10. turnaround
        '',             // 11. ghi_chu_kh
        noi_dung_email, // 12. noi_dung_email
        cot_kanban,     // 13. cot_kanban
        '',             // 14. designer
        ngay_len_don,   // 15. ngay_len_don
        '',             // 16. ngay_het_han
        ''              // 17. thu_tu
      ];

      await this._appendSheet(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', [rowData]);

      this.showToast(`Lên đơn thành công: ${ma_don}`, 'success');
      this._datLaiForm();
    } catch (err) {
      console.error('Lỗi khi lên đơn:', err);
      this.showToast('Lỗi khi lên đơn, xem console', 'error');
    } finally {
      this._isSubmittingDon = false;
      this._setLoadingState(btn, false, 'Lưu đơn hàng');
    }
  },
  async renderKhachHangPage() {
    const content = document.getElementById('page-content');
    content.style.padding = '24px';
    content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:80px 0;flex-direction:column;gap:16px;">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;border-color:rgba(138,114,76,0.2);border-top-color:var(--clr-accent);"></div>
      <p style="font-size:var(--font-size-sm);color:var(--clr-text-muted);">Đang tải dữ liệu khách hàng...</p>
    </div>`;

    let khachHangList = [], donHangList = [];
    await Promise.allSettled([
      this._readSheet(this.session.accessToken, CONFIG.SHEETS.KHACH_HANG, 'A:I')
        .then(r => { khachHangList = r || []; }),
      this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', 'A:T')
        .then(r => { donHangList = r || []; }),
    ]);

    this._khachHangListFull = khachHangList;
    
    // Đếm số đơn của mỗi khách
    const donCountMap = {};
    donHangList.forEach(d => {
      const ma = d.ma_kh;
      if (ma) donCountMap[ma] = (donCountMap[ma] || 0) + 1;
    });

    this._khachHangDataView = khachHangList.map(k => ({
      ...k,
      so_don: donCountMap[k.ma_kh] || 0
    })).sort((a, b) => b.so_don - a.so_don); // Sort by order count descending
    
    this._donHangDataKhach = donHangList; // to show in detail

    this._renderKhachHangTable();
  },

  _renderKhachHangTable(q = '') {
    const content = document.getElementById('page-content');
    q = q.toLowerCase();
    
    const filtered = this._khachHangDataView.filter(k => 
      (k.ma_kh || '').toLowerCase().includes(q) ||
      (k.ten_khach || '').toLowerCase().includes(q) ||
      (k.sdt || '').toLowerCase().includes(q) ||
      (k.zalo || '').toLowerCase().includes(q)
    );

    const rows = filtered.map(k => {
      const lienHe = [];
      if (k.sdt) lienHe.push(`SĐT: ${this._escHtml(k.sdt)}`);
      if (k.zalo) lienHe.push(`Zalo: ${this._escHtml(k.zalo)}`);
      if (k.fanpage || k.facebook) lienHe.push(`FB: ${this._escHtml(k.fanpage || k.facebook)}`);
      
      return `
        <tr class="table-row-hover" style="cursor:pointer;" onclick="App._openKhachHangDetail('${this._escHtml(k.ma_kh)}')">
          <td style="padding:12px; border-bottom:1px solid var(--clr-border-light); font-weight:600; color:var(--clr-accent);">${this._escHtml(k.ma_kh)}</td>
          <td style="padding:12px; border-bottom:1px solid var(--clr-border-light); font-weight:500;">${this._escHtml(k.ten_khach)}</td>
          <td style="padding:12px; border-bottom:1px solid var(--clr-border-light);">${this._escHtml(k.brand || '—')}</td>
          <td style="padding:12px; border-bottom:1px solid var(--clr-border-light);">${this._escHtml(k.nganh || '—')}</td>
          <td style="padding:12px; border-bottom:1px solid var(--clr-border-light); font-size:12px; color:var(--clr-text-muted);">${lienHe.join('<br>') || '—'}</td>
          <td style="padding:12px; border-bottom:1px solid var(--clr-border-light); text-align:center;"><span style="display:inline-block; padding:2px 8px; background:rgba(138,114,76,0.1); border-radius:12px; font-weight:600; font-size:12px; color:var(--clr-accent);">${k.so_don} đơn</span></td>
        </tr>
      `;
    }).join('');

    const emptyState = `<tr><td colspan="6" style="padding:32px; text-align:center; color:var(--clr-text-muted);">Không tìm thấy khách hàng nào.</td></tr>`;
    
    const tbody = document.getElementById('khach-hang-tbody');
    const countEl = document.getElementById('khach-hang-count');

    if (tbody && countEl) {
      tbody.innerHTML = rows || emptyState;
      countEl.innerText = `Danh sách Khách Hàng (${filtered.length})`;
      return;
    }

    content.innerHTML = `
      <div style="max-width: 1200px; margin: 0 auto; background: var(--clr-card); border-radius: var(--radius-lg); box-shadow: var(--shadow-sm); overflow: hidden;">
        <div style="padding: var(--space-5); border-bottom: 1px solid var(--clr-border); display: flex; justify-content: space-between; align-items: center;">
          <h2 id="khach-hang-count" style="margin: 0; font-size: 18px; font-weight: 600;">Danh sách Khách Hàng (${filtered.length})</h2>
          <div style="display:flex; gap:12px; align-items:center;">
            ${this.session?.role === 'admin' ? `<button class="btn btn-outline btn-sm" onclick="App._syncKhachHang(event)" title="Tự động quét các khách hàng trong mục Đơn hàng chưa có trong danh sách Khách hàng">Đồng bộ khách hàng</button>` : ''}
            <div style="position:relative; width: 300px;">
              <input type="text" class="form-input khach-hang-search-input" placeholder="Tìm tên, mã KH, SĐT, Zalo..." value="${this._escHtml(q)}" oninput="App._renderKhachHangTable(this.value)" style="padding-left:36px; border-radius:20px;">
              <svg style="position:absolute; left:12px; top:50%; transform:translateY(-50%); color:var(--clr-text-muted);" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </div>
          </div>
        </div>
        <div style="overflow-x:auto;">
          <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 14px;">
            <thead>
              <tr style="background: rgba(0,0,0,0.02); color: var(--clr-text-muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
                <th style="padding:12px; border-bottom:1px solid var(--clr-border);">Mã KH</th>
                <th style="padding:12px; border-bottom:1px solid var(--clr-border);">Tên khách hàng</th>
                <th style="padding:12px; border-bottom:1px solid var(--clr-border);">Brand</th>
                <th style="padding:12px; border-bottom:1px solid var(--clr-border);">Ngành</th>
                <th style="padding:12px; border-bottom:1px solid var(--clr-border);">Liên hệ</th>
                <th style="padding:12px; border-bottom:1px solid var(--clr-border); text-align:center;">Lịch sử đặt</th>
              </tr>
            </thead>
            <tbody id="khach-hang-tbody">
              ${rows || emptyState}
            </tbody>
          </table>
        </div>
      </div>
    `;
  },
  
  _openKhachHangDetail(maKh) {
    const kh = this._khachHangListFull.find(k => k.ma_kh === maKh);
    if (!kh) return;

    // Lọc các đơn của khách
    const dons = this._donHangDataKhach.filter(d => d.ma_kh === maKh);
    const donsHtml = dons.map(d => `
      <div style="padding:10px; border:1px solid var(--clr-border-light); border-radius:8px; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
        <div>
          <div style="font-weight:600; color:var(--clr-accent);">${this._escHtml(d.ma_don)}</div>
          <div style="font-size:12px; color:var(--clr-text-muted);">${this._escHtml(d.item || '')}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:12px; color:var(--clr-text-muted);">${this._escHtml(d.ngay_len_don || '')}</div>
          <div style="font-size:12px; font-weight:600; color:${d.trang_thai === 'đang chạy' ? '#27AE60' : '#E74C3C'}">${this._escHtml(d.trang_thai || '')}</div>
        </div>
      </div>
    `).join('');

    const overlay = document.createElement('div');
    overlay.id = 'kh-detail-overlay';
    overlay.className = 'kb-overlay';
    overlay.innerHTML = `
      <div class="kb-detail-modal" style="max-width: 800px;">
        <div class="kb-detail-header">
          <div>
            <div class="kb-detail-id">Hồ sơ khách hàng: ${this._escHtml(kh.ma_kh)}</div>
            <div class="kb-detail-khach">Cập nhật lúc: ${this._formatDateToday()}</div>
          </div>
          <button class="kb-detail-close" onclick="App._closeKhDetail()">✕</button>
        </div>

        <div class="kb-detail-body" style="grid-template-columns: 1fr 300px; padding-top: 16px;">
          <!-- Cột trái: Chỉnh sửa thông tin -->
          <div class="kb-detail-left">
            <h3 style="margin-top:0; margin-bottom:16px; font-size:16px; font-weight:600; border-bottom:1px solid var(--clr-border-light); padding-bottom:8px;">Thông tin cơ bản</h3>
            
            <div class="form-grid form-grid-2">
              <div class="form-group">
                <label class="form-label">Tên khách hàng</label>
                <input type="text" class="form-input" id="kh-det-ten" value="${this._escHtml(kh.ten_khach)}">
              </div>
              <div class="form-group">
                <label class="form-label">Brand</label>
                <input type="text" class="form-input" id="kh-det-brand" value="${this._escHtml(kh.brand)}">
              </div>
                <label class="form-label">Ngành</label>
                <input type="text" class="form-input" id="kh-det-nganh" value="${this._escHtml(kh.nganh)}">
              </div>
            </div>

            <h3 style="margin-top:24px; margin-bottom:16px; font-size:16px; font-weight:600; border-bottom:1px solid var(--clr-border-light); padding-bottom:8px;">Thông tin liên hệ</h3>
            <div class="form-grid form-grid-2">
              <div class="form-group">
                <label class="form-label">Facebook/Fanpage</label>
                <input type="text" class="form-input" id="kh-det-fanpage" value="${this._escHtml(kh.fanpage || kh.facebook || '')}">
              </div>
              <div class="form-group">
                <label class="form-label">Số Zalo</label>
                <input type="text" class="form-input" id="kh-det-zalo" value="${this._escHtml(kh.zalo)}">
              </div>
              <div class="form-group">
                <label class="form-label">Số điện thoại</label>
                <input type="text" class="form-input" id="kh-det-sdt" value="${this._escHtml(kh.sdt)}">
              </div>
            </div>
            
            <div class="form-group" style="margin-top: 16px;">
              <label class="form-label">Ghi chú</label>
              <textarea class="form-textarea" id="kh-det-ghichu" rows="3">${this._escHtml(kh.ghi_chu || '')}</textarea>
            </div>
          </div>

          <!-- Cột phải: Lịch sử đơn hàng -->
          <div class="kb-detail-right" style="border-left: 1px solid var(--clr-border-light); padding-left: 20px;">
            <div class="kb-detail-section-title">Lịch sử đơn hàng (${dons.length})</div>
            <div style="max-height: 400px; overflow-y: auto; padding-right: 4px;">
              ${donsHtml || '<div style="font-size:12px;color:var(--clr-text-muted);">Khách chưa có đơn hàng nào.</div>'}
            </div>
          </div>
        </div>

        <div class="kb-detail-footer">
          <button class="btn btn-ghost" onclick="App._closeKhDetail()">Đóng</button>
          <button class="btn btn-primary" id="btn-save-kh" onclick="App._saveKhDetail('${this._escHtml(kh.ma_kh)}')">
            Lưu thay đổi
          </button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeKhDetail(); });
    requestAnimationFrame(() => overlay.classList.add('kb-overlay-visible'));
  },

  _closeKhDetail() {
    const overlay = document.getElementById('kh-detail-overlay');
    if (!overlay) return;
    overlay.classList.remove('kb-overlay-visible');
    setTimeout(() => overlay.remove(), 250);
  },

  async _saveKhDetail(maKh) {
    const btn = document.getElementById('btn-save-kh');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang lưu...'; }

    try {
      const ten_khach = document.getElementById('kh-det-ten').value.trim();
      const brand = document.getElementById('kh-det-brand').value.trim();
      const nganh = document.getElementById('kh-det-nganh').value.trim();
      const fanpage = document.getElementById('kh-det-fanpage').value.trim();
      const zalo = document.getElementById('kh-det-zalo').value.trim();
      const sdt = document.getElementById('kh-det-sdt').value.trim();
      const ghi_chu = document.getElementById('kh-det-ghichu').value.trim();

      const rawKH = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.KHACH_HANG, 'A:I');
      const rowIndex = rawKH.findIndex(r => r.ma_kh === maKh);
      
      if (rowIndex >= 0) {
        const rowNum = rowIndex + 2; // +1 for header, +1 for 0-index
        const oldRow = rawKH[rowIndex];
        const updateData = [
          maKh, ten_khach, brand, nganh, fanpage, zalo, sdt, 
          oldRow.ngay_tao || this._formatDateToday(), 
          ghi_chu
        ];
        
        await this._writeSheet(CONFIG.SHEETS.KHACH_HANG, `A${rowNum}:I${rowNum}`, [updateData]);
        this._showToast('Đã lưu hồ sơ khách hàng!', 'success');
        
        // Update local cache
        const khIndex = this._khachHangListFull.findIndex(k => k.ma_kh === maKh);
        if (khIndex >= 0) {
          this._khachHangListFull[khIndex] = {
            ...this._khachHangListFull[khIndex],
            ten_khach, brand, nganh, fanpage, zalo, sdt, ghi_chu
          };
        }
        
        // Refresh view data array
        const viewIndex = this._khachHangDataView.findIndex(k => k.ma_kh === maKh);
        if (viewIndex >= 0) {
          this._khachHangDataView[viewIndex] = {
            ...this._khachHangDataView[viewIndex],
            ten_khach, brand, nganh, fanpage, zalo, sdt, ghi_chu
          };
        }
        
        // Refresh table if searching
        const searchInput = document.querySelector('.khach-hang-search-input');
        this._renderKhachHangTable(searchInput ? searchInput.value : '');
        this._closeKhDetail();
      } else {
        throw new Error("Không tìm thấy dòng khách hàng trong Google Sheets!");
      }
      
    } catch (err) {
      console.error(err);
      this._showToast('Lỗi lưu khách hàng: ' + err.message, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Lưu thay đổi'; }
    }
  },

  _formatDateToday() {
    const n = new Date();
    return `${String(n.getDate()).padStart(2,'0')}/${String(n.getMonth()+1).padStart(2,'0')}/${n.getFullYear()}`;
  },

  _formatDateFromInput(s) {
    if (!s) return '';
    const [y, m, d] = s.split('-');
    return `${d}/${m}/${y}`;
  },

  _formatNumber(num) {
    if (isNaN(num)) return '0';
    return Number(num).toLocaleString('vi-VN');
  },

  _formatVND(num) {
    if (isNaN(num)) return '0 đ';
    return this._formatNumber(num) + ' đ';
  },

  _parseCurrency(val) {
    if (val === undefined || val === null || val === '') return 0;
    // Bỏ tất cả dấu phẩy, dấu chấm, khoảng trắng
    // Ví dụ: 150.000 -> 150000, 1.500.000,00 -> 150000000
    // Wait, regex [^0-9-] removes dots and commas. So "149.850" becomes "149850"
    const cleaned = val.toString().replace(/[^0-9-]/g, '');
    const parsed = parseInt(cleaned, 10);
    return isNaN(parsed) ? 0 : parsed;
  },

  // ════════════════════════════════════════════════════════════
  //  MÀN HÌNH DOANH THU PIXEL
  // ════════════════════════════════════════════════════════════

  async renderDoanhThuPage() {
    const content = document.getElementById('page-content');
    content.style.padding = '24px';
    content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:80px 0;flex-direction:column;gap:16px;">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;border-color:rgba(138,114,76,0.2);border-top-color:var(--clr-accent);"></div>
      <p style="font-size:var(--font-size-sm);color:var(--clr-text-muted);">Đang tải dữ liệu doanh thu...</p>
    </div>`;

    try {
      const [gdData, donData, danhMucNganh, danhMucItem, tienDonData] = await Promise.all([
        this._readSheet(this.session.accessToken, CONFIG.SHEETS.GIAO_DICH_TIEN, 'A:E'),
        this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', 'A:T'),
        this._readSheet(this.session.accessToken, CONFIG.SHEETS.DANH_MUC_SHOP),
        this._readSheet(this.session.accessToken, CONFIG.SHEETS.DANH_MUC_LOAI),
        this._readSheet(this.session.accessToken, CONFIG.SHEETS.TIEN_DON, 'A:B').catch(() => [])
      ]);

      this._doanhThuData = gdData || [];
      const donHangList = donData || [];
      const tienDonList = tienDonData || [];
      
      const tienDonMap = {};
      tienDonList.forEach(row => { if (row.ma_don) tienDonMap[row.ma_don] = row.tong_gia_tri; });
      donHangList.forEach(d => { if (tienDonMap[d.ma_don] !== undefined) d.tong_gia_tri = tienDonMap[d.ma_don]; });
      
      const donMap = {};
      donHangList.forEach(d => {
        if (d.ma_don) {
          donMap[d.ma_don] = {
            nganh: d.nganh || '',
            sale_phu_trach: d.sale_phu_trach || '',
            ma_kh: d.ma_kh || '',
            item: d.item || ''
          };
        }
      });

      const uniqueSale = new Set();
      const uniqueKh = new Set();
      const uniqueLoai = new Set();

      this._doanhThuData.forEach(r => {
        if (r.ngay) {
          const [d, m, y] = r.ngay.split('/');
          r.parsedDate = new Date(y, m - 1, d);
        } else {
          r.parsedDate = new Date(0);
        }
        r.so_tien = this._parseCurrency(r.so_tien);

        const donInfo = donMap[r.ma_don] || {};
        r.nganh = donInfo.nganh;
        r.sale_phu_trach = donInfo.sale_phu_trach;
        r.ma_kh = donInfo.ma_kh;
        r.item = donInfo.item;

        if (r.sale_phu_trach) uniqueSale.add(r.sale_phu_trach);
        if (r.ma_kh) uniqueKh.add(r.ma_kh);
        if (r.loai) uniqueLoai.add(r.loai);
      });

      this._doanhThuFilters = {
        nganh: (danhMucNganh || []).map(r => r.ten_nganh).filter(Boolean),
        sale: Array.from(uniqueSale).sort(),
        kh: Array.from(uniqueKh).sort(),
        item: (danhMucItem || []).map(r => r.ten_item).filter(Boolean),
        loai: Array.from(uniqueLoai).sort()
      };

      this._renderDoanhThuContent('month'); // default to this month
    } catch (e) {
      console.error(e);
      content.innerHTML = `<div style="color:var(--clr-error); padding:24px;">Lỗi tải dữ liệu: ${this._escHtml(e.message)}</div>`;
    }
  },

  _renderDoanhThuContent(filterType = 'month', customFrom = '', customTo = '', fNganh = 'all', fSale = 'all', fKh = 'all', fItem = 'all', fLoai = 'all') {
    const content = document.getElementById('page-content');
    const today = new Date();
    let startDate, endDate;

    if (filterType === 'month') {
      startDate = new Date(today.getFullYear(), today.getMonth(), 1);
      endDate = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59);
    } else if (filterType === 'last_month') {
      startDate = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      endDate = new Date(today.getFullYear(), today.getMonth(), 0, 23, 59, 59);
    } else if (filterType === 'quarter') {
      const q = Math.floor(today.getMonth() / 3);
      startDate = new Date(today.getFullYear(), q * 3, 1);
      endDate = new Date(today.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
    } else if (filterType === 'year') {
      startDate = new Date(today.getFullYear(), 0, 1);
      endDate = new Date(today.getFullYear(), 11, 31, 23, 59, 59);
    } else if (filterType === 'custom') {
      startDate = customFrom ? new Date(customFrom + 'T00:00:00') : new Date(0);
      endDate = customTo ? new Date(customTo + 'T23:59:59') : new Date('2999-12-31');
    }

    let tongDoanhThu = 0;
    let tongThu = 0;
    let tongHoan = 0;
    let tongTip = 0;
    let soGiaoDich = 0;

    const dailyMap = {};
    this._doanhThuCurrentFilteredData = [];

    this._doanhThuData.forEach(r => {
      // Filter by date
      if (r.parsedDate < startDate || r.parsedDate > endDate) return;

      // Filter combinations
      if (fNganh !== 'all' && r.nganh !== fNganh) return;
      if (fSale !== 'all' && r.sale_phu_trach !== fSale) return;
      if (fKh !== 'all' && r.ma_kh !== fKh) return;
      if (fItem !== 'all' && r.item !== fItem) return;
      if (fLoai !== 'all' && r.loai !== fLoai) return;

      const tien = r.so_tien;
      tongDoanhThu += tien;
      soGiaoDich++;

      if (tien > 0) tongThu += tien;
      if (tien < 0) tongHoan += Math.abs(tien);
      if (r.loai && r.loai.toLowerCase() === 'tip') tongTip += tien;

      const dateStr = r.ngay || 'Chưa rõ';
      if (!dailyMap[dateStr]) {
        dailyMap[dateStr] = { date: dateStr, parsedDate: r.parsedDate, total: 0, count: 0 };
      }
      dailyMap[dateStr].total += tien;
      dailyMap[dateStr].count += 1;
      this._doanhThuCurrentFilteredData.push(r);
    });

    // Sắp xếp ngày từ mới nhất đến cũ nhất (mới nhất ở trên)
    const dailyArr = Object.values(dailyMap).sort((a, b) => b.parsedDate - a.parsedDate);
    
    // Lưu tạm cho tính năng xuất Excel
    this._doanhThuCurrentExport = dailyArr;

    const btnStyle = "padding:6px 12px; border-radius:16px; border:1px solid var(--clr-border-light); background:var(--clr-surface); cursor:pointer; font-size:13px; font-weight:500; color:var(--clr-text); transition:all 0.2s;";
    const btnActiveStyle = "padding:6px 12px; border-radius:16px; border:1px solid var(--clr-accent); background:var(--clr-accent); color:#fff; cursor:pointer; font-size:13px; font-weight:500; transition:all 0.2s;";
    const selectStyle = "padding:6px 10px; border-radius:8px; border:1px solid var(--clr-border-light); font-size:13px; background:var(--clr-surface); max-width:150px;";

    const buildOptions = (arr, currentVal) => {
      let html = `<option value="all">Tất cả</option>`;
      arr.forEach(item => {
        const selected = item === currentVal ? 'selected' : '';
        html += `<option value="${this._escHtml(item)}" ${selected}>${this._escHtml(item)}</option>`;
      });
      return html;
    };

    const filterOnChange = `App._renderDoanhThuContent('${filterType}', '${customFrom}', '${customTo}', document.getElementById('dt-nganh').value, document.getElementById('dt-sale').value, document.getElementById('dt-kh').value, document.getElementById('dt-item').value, document.getElementById('dt-loai').value)`;
    const resetFilterClick = `App._renderDoanhThuContent('month', '', '', 'all', 'all', 'all', 'all', 'all')`;

    content.innerHTML = `
      <div style="max-width: 1200px; margin: 0 auto; display:flex; flex-direction:column; gap:24px;">
        
        <!-- BỘ LỌC -->
        <div style="background:var(--clr-card); padding:20px; border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); display:flex; flex-direction:column; gap:16px;">
          
          <div style="display:flex; flex-wrap:wrap; gap:16px; align-items:center; justify-content:space-between;">
            <div style="display:flex; gap:8px; flex-wrap:wrap;">
              <button style="${filterType === 'month' ? btnActiveStyle : btnStyle}" onclick="App._renderDoanhThuContent('month', '', '', '${this._escHtml(fNganh)}', '${this._escHtml(fSale)}', '${this._escHtml(fKh)}', '${this._escHtml(fItem)}', '${this._escHtml(fLoai)}')">Tháng này</button>
              <button style="${filterType === 'last_month' ? btnActiveStyle : btnStyle}" onclick="App._renderDoanhThuContent('last_month', '', '', '${this._escHtml(fNganh)}', '${this._escHtml(fSale)}', '${this._escHtml(fKh)}', '${this._escHtml(fItem)}', '${this._escHtml(fLoai)}')">Tháng trước</button>
              <button style="${filterType === 'quarter' ? btnActiveStyle : btnStyle}" onclick="App._renderDoanhThuContent('quarter', '', '', '${this._escHtml(fNganh)}', '${this._escHtml(fSale)}', '${this._escHtml(fKh)}', '${this._escHtml(fItem)}', '${this._escHtml(fLoai)}')">Quý này</button>
              <button style="${filterType === 'year' ? btnActiveStyle : btnStyle}" onclick="App._renderDoanhThuContent('year', '', '', '${this._escHtml(fNganh)}', '${this._escHtml(fSale)}', '${this._escHtml(fKh)}', '${this._escHtml(fItem)}', '${this._escHtml(fLoai)}')">Năm nay</button>
            </div>
            <div style="display:flex; gap:12px; align-items:center;">
              <span style="font-size:14px; font-weight:500;">Hoặc chọn ngày:</span>
              <input type="date" id="dt-from" class="form-input" style="width:140px; padding:6px 10px;" value="${customFrom}">
              <span style="color:var(--clr-text-muted);">-</span>
              <input type="date" id="dt-to" class="form-input" style="width:140px; padding:6px 10px;" value="${customTo}">
              <button class="btn btn-outline btn-sm" onclick="App._renderDoanhThuContent('custom', document.getElementById('dt-from').value, document.getElementById('dt-to').value, '${this._escHtml(fNganh)}', '${this._escHtml(fSale)}', '${this._escHtml(fKh)}', '${this._escHtml(fItem)}', '${this._escHtml(fLoai)}')">Lọc</button>
            </div>
          </div>

          <div style="border-top:1px dashed var(--clr-border-light); margin:4px 0;"></div>

          <!-- BỘ LỌC KẾT HỢP -->
          <div style="display:flex; flex-wrap:wrap; gap:12px; align-items:center;">
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:13px; font-weight:500;">Ngành:</label>
              <select id="dt-nganh" style="${selectStyle}" onchange="${filterOnChange}">
                ${buildOptions(this._doanhThuFilters.nganh, fNganh)}
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:13px; font-weight:500;">Sale:</label>
              <select id="dt-sale" style="${selectStyle}" onchange="${filterOnChange}">
                ${buildOptions(this._doanhThuFilters.sale, fSale)}
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:13px; font-weight:500;">Mã KH:</label>
              <select id="dt-kh" style="${selectStyle}" onchange="${filterOnChange}">
                ${buildOptions(this._doanhThuFilters.kh, fKh)}
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:13px; font-weight:500;">Item:</label>
              <select id="dt-item" style="${selectStyle}" onchange="${filterOnChange}">
                ${buildOptions(this._doanhThuFilters.item, fItem)}
              </select>
            </div>
            <div style="display:flex; align-items:center; gap:6px;">
              <label style="font-size:13px; font-weight:500;">Loại giao dịch:</label>
              <select id="dt-loai" style="${selectStyle}" onchange="${filterOnChange}">
                ${buildOptions(this._doanhThuFilters.loai, fLoai)}
              </select>
            </div>
            <div style="flex-grow:1; text-align:right;">
              <button class="btn btn-ghost btn-sm" onclick="${resetFilterClick}" style="color:var(--clr-error);">Xóa bộ lọc</button>
            </div>
          </div>
        </div>

        <!-- CHỈ SỐ TỔNG -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:16px;">
          <div style="background:var(--clr-card); padding:20px; border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border-bottom:4px solid var(--clr-accent);">
            <div style="font-size:13px; color:var(--clr-text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px; margin-bottom:8px;">Tổng doanh thu</div>
            <div style="font-size:28px; font-weight:700; color:var(--clr-text);">${this._formatVND(tongDoanhThu)}</div>
          </div>
          <div style="background:var(--clr-card); padding:20px; border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border-bottom:4px solid #27AE60;">
            <div style="font-size:13px; color:var(--clr-text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px; margin-bottom:8px;">Tổng thu</div>
            <div style="font-size:28px; font-weight:700; color:#27AE60;">${this._formatVND(tongThu)}</div>
          </div>
          <div style="background:var(--clr-card); padding:20px; border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border-bottom:4px solid #E74C3C;">
            <div style="font-size:13px; color:var(--clr-text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px; margin-bottom:8px;">Tổng hoàn</div>
            <div style="font-size:28px; font-weight:700; color:#E74C3C;">${this._formatVND(tongHoan)}</div>
          </div>
          <div style="background:var(--clr-card); padding:20px; border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border-bottom:4px solid #F39C12;">
            <div style="font-size:13px; color:var(--clr-text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px; margin-bottom:8px;">Tổng tip</div>
            <div style="font-size:28px; font-weight:700; color:#F39C12;">${this._formatVND(tongTip)}</div>
          </div>
          <div style="background:var(--clr-card); padding:20px; border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); border-bottom:4px solid #5B8DB8;">
            <div style="font-size:13px; color:var(--clr-text-muted); text-transform:uppercase; font-weight:600; letter-spacing:0.5px; margin-bottom:8px;">Số giao dịch</div>
            <div style="font-size:28px; font-weight:700; color:#5B8DB8;">${this._formatNumber(soGiaoDich)}</div>
          </div>
        </div>

        <!-- BIỂU ĐỒ -->
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr)); gap:16px; margin-bottom:16px;">
          <!-- Biểu đồ đường (Trend) -->
          <div style="background:var(--clr-card); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); padding:20px; display:flex; flex-direction:column;">
            <h3 style="margin:0 0 16px 0; font-size:16px; font-weight:600;">Xu hướng Doanh thu</h3>
            <div style="flex-grow:1; min-height:300px; position:relative; display:flex; justify-content:center; align-items:center;">
              <canvas id="chart-trend"></canvas>
              <div id="chart-trend-empty" style="display:none; color:var(--clr-text-muted); font-size:14px; position:absolute;">Không có dữ liệu để vẽ biểu đồ</div>
            </div>
          </div>
          <!-- Biểu đồ tỷ trọng -->
          <div style="background:var(--clr-card); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); padding:20px; display:flex; flex-direction:column;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
              <h3 style="margin:0; font-size:16px; font-weight:600;">Cơ cấu Doanh thu</h3>
              <select id="chart-pie-dimension" class="form-select" style="width:auto; padding:4px 24px 4px 8px; font-size:13px;" onchange="App._drawDoanhThuPieChart(this.value)">
                <option value="nganh">Theo Ngành</option>
                <option value="sale_phu_trach">Theo Sale</option>
                <option value="item">Theo Item</option>
              </select>
            </div>
            <div style="flex-grow:1; min-height:300px; position:relative; display:flex; justify-content:center; align-items:center;">
              <canvas id="chart-pie"></canvas>
              <div id="chart-pie-empty" style="display:none; color:var(--clr-text-muted); font-size:14px; position:absolute;">Không có dữ liệu để vẽ biểu đồ</div>
            </div>
          </div>
        </div>

        <!-- BẢNG THEO NGÀY -->
        <div style="background:var(--clr-card); border-radius:var(--radius-lg); box-shadow:var(--shadow-sm); overflow:hidden;">
          <div style="padding:20px; border-bottom:1px solid var(--clr-border-light); display:flex; justify-content:space-between; align-items:center;">
            <h3 style="margin:0; font-size:16px; font-weight:600;">Doanh thu theo ngày</h3>
            <button class="btn btn-outline btn-sm" onclick="App._exportDoanhThuCsv()">
              <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right:6px;" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Xuất Excel
            </button>
          </div>
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:14px;">
              <thead>
                <tr style="background:rgba(0,0,0,0.02); color:var(--clr-text-muted); font-size:12px; text-transform:uppercase; letter-spacing:0.05em; text-align:left;">
                  <th style="padding:16px 20px; border-bottom:1px solid var(--clr-border-light);">Ngày</th>
                  <th style="padding:16px 20px; border-bottom:1px solid var(--clr-border-light); text-align:center;">Số giao dịch</th>
                  <th style="padding:16px 20px; border-bottom:1px solid var(--clr-border-light); text-align:right;">Tổng thu trong ngày</th>
                </tr>
              </thead>
              <tbody>
                ${dailyArr.length > 0 ? dailyArr.map(r => `
                  <tr class="table-row-hover">
                    <td style="padding:16px 20px; border-bottom:1px solid var(--clr-border-light); font-weight:500;">${r.date}</td>
                    <td style="padding:16px 20px; border-bottom:1px solid var(--clr-border-light); text-align:center;">${r.count}</td>
                    <td style="padding:16px 20px; border-bottom:1px solid var(--clr-border-light); text-align:right; font-weight:600; color:${r.total >= 0 ? 'var(--clr-accent)' : '#E74C3C'}">${this._formatVND(r.total)}</td>
                  </tr>
                `).join('') : `<tr><td colspan="3" style="padding:32px; text-align:center; color:var(--clr-text-muted);">Không có doanh thu trong kỳ này</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    `;

    setTimeout(() => this._initDoanhThuCharts(dailyArr), 100);
  },

  _initDoanhThuCharts(dailyArr) {
    if (!window.Chart) return;
    this._doanhThuCharts = this._doanhThuCharts || {};

    // 1. Vẽ biểu đồ Đường
    if (this._doanhThuCharts.trend) {
      this._doanhThuCharts.trend.destroy();
    }
    
    const canvasTrend = document.getElementById('chart-trend');
    const emptyTrend = document.getElementById('chart-trend-empty');
    if (canvasTrend && emptyTrend) {
      if (!dailyArr || dailyArr.length === 0) {
        canvasTrend.style.display = 'none';
        emptyTrend.style.display = 'block';
      } else {
        canvasTrend.style.display = 'block';
        emptyTrend.style.display = 'none';

        const chartData = [...dailyArr].reverse();
        const labels = chartData.map(r => r.date.substring(0, 5)); 

        this._doanhThuCharts.trend = new Chart(canvasTrend, {
          type: 'line',
          data: {
            labels: labels,
            datasets: [{
              label: 'Doanh thu (VNĐ)',
              data: chartData.map(r => r.total),
              borderColor: '#8A724C',
              backgroundColor: 'rgba(138, 114, 76, 0.1)',
              borderWidth: 2,
              tension: 0.3,
              fill: true,
              pointBackgroundColor: '#8A724C',
            }]
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true } }
          }
        });
      }
    }

    // 2. Vẽ biểu đồ Tròn
    const dimSelect = document.getElementById('chart-pie-dimension');
    if (dimSelect) {
      this._drawDoanhThuPieChart(dimSelect.value);
    }
  },

  _drawDoanhThuPieChart(dimension) {
    if (!window.Chart) return;
    this._doanhThuCharts = this._doanhThuCharts || {};
    
    if (this._doanhThuCharts.pie) {
      this._doanhThuCharts.pie.destroy();
    }

    const canvasPie = document.getElementById('chart-pie');
    const emptyPie = document.getElementById('chart-pie-empty');
    if (!canvasPie || !emptyPie) return;

    if (!this._doanhThuCurrentFilteredData || this._doanhThuCurrentFilteredData.length === 0) {
      canvasPie.style.display = 'none';
      emptyPie.style.display = 'block';
      return;
    }

    const mapGroup = {};
    this._doanhThuCurrentFilteredData.forEach(r => {
      let key = r[dimension];
      if (typeof key === 'string') key = key.trim();
      if (!key) key = 'Không xác định';
      if (!mapGroup[key]) mapGroup[key] = 0;
      mapGroup[key] += r.so_tien;
    });

    const keys = [];
    const values = [];
    Object.entries(mapGroup)
      .sort((a, b) => b[1] - a[1]) // Giảm dần
      .forEach(([k, v]) => {
        if (v > 0) {
          keys.push(k);
          values.push(v);
        }
      });

    if (values.length === 0) {
      canvasPie.style.display = 'none';
      emptyPie.style.display = 'block';
      return;
    }

    canvasPie.style.display = 'block';
    emptyPie.style.display = 'none';

    // Bảng màu hài hòa với #8A724C (Vàng Nâu)
    const colors = ['#8A724C', '#A8926C', '#C6B28C', '#E4D2AC', '#5B8DB8', '#27AE60', '#E74C3C', '#F39C12', '#9B59B6', '#34495E', '#16A085', '#D35400'];

    this._doanhThuCharts.pie = new Chart(canvasPie, {
      type: 'doughnut',
      data: {
        labels: keys,
        datasets: [{
          data: values,
          backgroundColor: colors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: 'right' },
          tooltip: {
            callbacks: {
              label: (context) => {
                const label = context.label || '';
                const val = context.raw || 0;
                return label + ': ' + App._formatVND(val);
              }
            }
          }
        }
      }
    });
  },

  _exportDoanhThuCsv() {
    if (!this._doanhThuCurrentExport || this._doanhThuCurrentExport.length === 0) {
      this._showToast('Không có dữ liệu để xuất.', 'error');
      return;
    }
    const headers = ['Ngày', 'Số giao dịch', 'Tổng thu trong ngày'];
    const rows = this._doanhThuCurrentExport.map(r => [
      r.date, 
      r.count, 
      r.total
    ]);
    
    // Add BOM for Excel UTF-8
    let csvContent = '\\uFEFF' + headers.join(',') + '\\n';
    rows.forEach(r => {
      csvContent += r.join(',') + '\\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Doanh_Thu_Pixel_${this._formatDateToday().replace(/\\//g,'-')}.csv`;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  // ════════════════════════════════════════════════════════════
  //  KANBAN PAGE
  // ════════════════════════════════════════════════════════════

  KANBAN_COLS: [
    'Chờ thông tin',
    'Đơn mới',
    'Gửi khách hàng',
    'Cần chỉnh sửa',
    'Hoàn thành',
  ],

  LABEL_PRESETS: [
    { nhan: 'Ưu tiên',     mau: '#E67E22' },
    { nhan: 'Gấp',         mau: '#E74C3C' },
    { nhan: 'Đã thanh toán', mau: '#8E44AD' },
    { nhan: 'Chỉnh sửa nhỏ', mau: '#1E8449' },
    { nhan: 'Đúng deadline', mau: '#27AE60' },
    { nhan: 'Lưu trữ',      mau: '#7F8C8D' },
  ],

  async renderKanbanPage() {
    const content = document.getElementById('page-content');
    content.style.padding = '24px';
    content.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;padding:80px 0;flex-direction:column;gap:16px;">
      <div class="spinner" style="width:32px;height:32px;border-width:3px;border-color:rgba(138,114,76,0.2);border-top-color:var(--clr-accent);"></div>
      <p style="font-size:var(--font-size-sm);color:var(--clr-text-muted);">Đang tải bảng Kanban...</p>
    </div>`;

    // Load DON_HANG + DIEM_DESIGNER + NHAN_SU + COMMENT concurrently
    let donHangList = [], diemDesignerList = [];
    await Promise.allSettled([
      this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_HANG || 'DON_ETSY', 'A:T')
        .then(r => { donHangList = r || []; })
        .catch(e => console.warn('[Kanban] DON_HANG:', e.message)),
      this._readSheet(this.session.accessToken, CONFIG.SHEETS.DIEM_DESIGNER)
        .then(r => { diemDesignerList = r || []; })
        .catch(e => console.warn('[Kanban] DIEM_DESIGNER:', e.message)),
      this._readSheet(this.session.accessToken, CONFIG.SHEETS.NHAN_SU)
        .then(r => { this._nhanSuList = r || []; })
        .catch(e => console.warn('[Kanban] NHAN_SU:', e.message)),
      this._readSheet(this.session.accessToken, CONFIG.SHEETS.COMMENT)
        .then(r => { this._commentList = r || []; })
        .catch(e => console.warn('[Kanban] COMMENT:', e.message)),
    ]);

    const tienDonMap = {};
    donHangList.forEach(d => { if (tienDonMap[d.ma_don] !== undefined) d.tong_gia_tri = tienDonMap[d.ma_don]; });

    // Cache the mapping globally in case other methods need it (like _openCardDetail which relies on donHangList)
    this._donHangList = donHangList;


    // Build designer lookup: ma_don → [ten_designer, ...]
    const designerMap = {};
    const designerScoreMap = {};
    diemDesignerList.forEach(d => {
      const ma = d.ma_don || '';
      if (!ma) return;
      if (!designerMap[ma]) designerMap[ma] = [];
      if (!designerScoreMap[ma]) designerScoreMap[ma] = {};
      let ten = d.ten_designer || d.designer || d.ho_ten || d.ten || '';
      
      if (ten.includes('@') && this._nhanSuList) {
         const ns = this._nhanSuList.find(n => n.email === ten);
         if (ns) {
            ten = ns.ten || ns.ho_ten || ns.ten_nhan_vien || ten;
         }
      }
      
      if (ten && !designerMap[ma].includes(ten)) {
        designerMap[ma].push(ten);
        designerScoreMap[ma][ten] = d.diem || '';
      }
    });
    this._kanbanDesignerScoreMap = designerScoreMap;

    // Label and KhachHang lookups are not used in ETSY
    const labelMap = {};
    const khachHangMap = {};

    this._kanbanData        = donHangList;
    this._kanbanDesignerMap = designerMap;
    this._kanbanLabelMap    = labelMap;
    this._kanbanKhachHangMap= khachHangMap;
    this._kanbanNhanDonRaw  = [];

    // Cache row index
    this._kanbanRowMap = {};
    donHangList.forEach((d, idx) => { this._kanbanRowMap[d.ma_don] = idx + 2; });

    this._renderKanbanBoard();
  },

  _renderKanbanBoard(filterQ = '') {
    // Save scroll state before replacing innerHTML
    const board = document.getElementById('kb-board');
    const scrollState = {
      windowY: window.scrollY,
      boardX: board ? board.scrollLeft : 0,
      boardY: board ? board.scrollTop : 0,
      colsY: Array.from(document.querySelectorAll('.kb-col-body')).map(c => c.scrollTop)
    };

    const content = document.getElementById('page-content');
    const q = filterQ.toLowerCase();
    const donList = this._kanbanData || [];

    let filtered = q
      ? donList.filter(d =>
          (d.ma_don || '').toLowerCase().includes(q) ||
          (d.ten_khach || '').toLowerCase().includes(q) ||
          (d.brand || '').toLowerCase().includes(q))
      : [...donList];

    // Sort by thu_tu
    filtered.sort((a, b) => {
       const orderA = (a.thu_tu !== undefined && a.thu_tu !== '') ? parseFloat(a.thu_tu) : 0;
       const orderB = (b.thu_tu !== undefined && b.thu_tu !== '') ? parseFloat(b.thu_tu) : 0;
       return orderA - orderB;
    });

    // Group by cot_kanban
    const colMap = {};
    this.KANBAN_COLS.forEach(c => { colMap[c] = []; });
    filtered.forEach(d => {
      const col = d.cot_kanban || 'Đơn mới';
      if (!colMap[col]) colMap[col] = [];
      colMap[col].push(d);
    });

    const totalActive = filtered.filter(d => !d.trang_thai || d.trang_thai === 'đang chạy').length;

    content.innerHTML = `
      <div class="kb-wrapper">
        <div class="kb-topbar">
          <div class="kb-search-wrapper">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="kb-search" id="kb-search-input" placeholder="Tìm theo mã đơn, tên khách, brand..." value="${this._escHtml(filterQ)}" oninput="App._onKanbanSearch(this.value)" autocomplete="off"/>
          </div>
          <div class="kb-stats">
            <span class="kb-stat-badge">${totalActive} đơn đang chạy</span>
            <button class="btn btn-ghost btn-sm" onclick="App.renderKanbanPage()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/></svg>
              Tải lại
            </button>
          </div>
        </div>

        <div class="kb-board" id="kb-board">
          ${this.KANBAN_COLS.map(col => this._renderKanbanCol(col, colMap[col] || [])).join('')}
        </div>
      </div>
    `;

    this._setupKanbanDnD();

    // Restore scroll state
    if (scrollState.windowY) window.scrollTo(0, scrollState.windowY);
    const newBoard = document.getElementById('kb-board');
    if (newBoard) {
       newBoard.scrollLeft = scrollState.boardX;
       newBoard.scrollTop = scrollState.boardY;
    }
    const newCols = document.querySelectorAll('.kb-col-body');
    newCols.forEach((c, i) => {
       if (scrollState.colsY[i]) c.scrollTop = scrollState.colsY[i];
    });
  },

  _renderKanbanCol(colName, cards) {
    const activeCount = cards.filter(d => !d.trang_thai || d.trang_thai === 'đang chạy').length;
    return `
      <div class="kb-col kb-col-${this._slugify(colName)}" data-col="${this._escHtml(colName)}"
           ondragover="App._onDragOver(event)" ondrop="App._onDrop(event, '${this._escHtml(colName)}')" ondragleave="App._onDragLeave(event)">
        <div class="kb-col-header">
          <span class="kb-col-title">${this._escHtml(colName)}</span>
          <span class="kb-col-count">${activeCount}</span>
        </div>
        <div class="kb-col-body" id="kb-col-${this._slugify(colName)}">
          ${cards.length === 0
            ? `<div class="kb-empty-drop">Kéo thẻ vào đây</div>`
            : cards.map(d => this._renderKanbanCard(d)).join('')}
        </div>
      </div>`;
  },

  _renderKanbanCard(d) {
    const isHuy        = false; // Not used for now
    const labels       = this._kanbanLabelMap?.[d.ma_don] || [];
    const deadline     = this._deadlineClass(d.ngay_het_han);
    const draggable    = 'true';

    // Label strips at top of card
    const labelsHtml = labels.length > 0
      ? `<div class="kb-card-labels">${labels.map(l =>
          `<span class="kb-label-pill" style="background:${this._escHtml(l.mau)}; color: #fff;" title="${this._escHtml(l.nhan)}">${this._escHtml(l.nhan)}</span>`
        ).join('')}</div>` : '';

    const turnaroundHtml = d.turnaround 
      ? `<div style="background:#FCE9E9; color:#B4453C; font-size:10px; font-weight:600; padding:2px 8px; border-radius:10px; display:inline-flex; align-items:center; gap:4px;" title="Turnaround">
           <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
           ${this._escHtml(d.turnaround)}
         </div>` : '';

    const deadlineHtml = d.ngay_het_han
      ? `<div class="kb-card-deadline ${deadline}">
           <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
           ${this._escHtml(d.ngay_het_han)}
         </div>` : '';
         
    const designersList = this._kanbanDesignerMap?.[d.ma_don] || [];
    const avatarsHtml = designersList.length > 0 ? `<div style="display:flex; gap:4px; margin-left:auto; align-items:center;">` + designersList.map(name => {
      const parts = name.trim().split(/\s+/);
      let initials = '?';
      if (parts.length >= 2) {
         initials = (parts[0][0] + parts[1][0]).toUpperCase();
      } else if (parts.length === 1 && parts[0]) {
         initials = parts[0][0].toUpperCase();
      }
      let hash = 0;
      for(let i=0; i<name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
      const colors = ['#8A724C', '#E74C3C', '#2ECC71', '#3498DB', '#9B59B6', '#F39C12', '#16A085', '#34495E'];
      const bg = colors[Math.abs(hash) % colors.length];
      return `<div style="width:20px; height:20px; border-radius:50%; background:${bg}; color:#fff; display:flex; align-items:center; justify-content:center; font-size:9px; font-weight:bold; flex-shrink:0;" title="${this._escHtml(name)}">${this._escHtml(initials)}</div>`;
    }).join('') + `</div>` : '';

    return `
      <div class="kb-card"
           data-don="${this._escHtml(d.ma_don)}"
           draggable="${draggable}"
           ondragstart="App._onDragStart(event, '${this._escHtml(d.ma_don)}')"
           ondragend="App._onDragEnd(event)"
           onclick="App._openCardDetail('${this._escHtml(d.ma_don)}')">
        ${labelsHtml}
        <div class="kb-card-top">
          <span class="kb-card-id">${this._escHtml(d.ma_don)}</span>
          ${d.item_name ? `<span class="kb-tag kb-tag-item">${this._escHtml(d.item_name)}</span>` : ''}
        </div>
        ${(d.shop || d.loai) ? `<div class="kb-card-brand">${[d.shop, d.loai].filter(Boolean).map(x => this._escHtml(x)).join(' &bull; ')}</div>` : ''}
        <div class="kb-card-name">${this._escHtml(d.ma_order_etsy || '')} - ${this._escHtml(d.buyer_name || '')}</div>
        <div class="kb-card-footer" style="display:flex; align-items:center; justify-content:space-between; margin-top:8px;">
          <div style="display:flex; align-items:center; gap:8px;">
            ${turnaroundHtml}
            ${deadlineHtml}
          </div>
          ${avatarsHtml}
        </div>
      </div>`;
  },

  _formatDatetimeLocal(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    let dStr = '', tStr = '';
    const dateTrim = dateStr.trim();
    if (!dateTrim) return '';
    
    if (dateTrim.includes('T')) {
       const isoParts = dateTrim.split('T');
       dStr = isoParts[0];
       tStr = isoParts[1] || '00:00';
    } else {
       const parts = dateTrim.split(/\s+/);
       dStr = parts[0];
       tStr = parts[1] || '00:00';
    }
    
    let y, m, d;
    if (dStr.includes('/')) {
       [d, m, y] = dStr.split('/');
    } else if (dStr.includes('-')) {
       [y, m, d] = dStr.split('-');
    } else {
       return '';
    }
    
    if (!y || !m || !d) return '';
    if (y.length === 2) y = '20' + y;
    
    y = y.padStart(4, '0');
    m = m.padStart(2, '0');
    d = d.padStart(2, '0');
    
    let [hh, mm] = tStr.split(':');
    if (!hh) hh = '00';
    if (!mm) mm = '00';
    hh = hh.padStart(2, '0');
    mm = mm.padStart(2, '0');
    
    const hour = parseInt(hh, 10);
    const minute = parseInt(mm, 10);
    if (isNaN(hour) || hour > 23 || hour < 0) hh = '00';
    if (isNaN(minute) || minute > 59 || minute < 0) mm = '00';
    
    return `${y}-${m}-${d}T${hh}:${mm}`;
  },

  _deadlineClass(dateStr) {
    const iso = this._formatDatetimeLocal(dateStr);
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    const diff = (d - now) / (1000 * 60 * 60 * 24);
    if (diff < 0)  return 'kb-deadline-overdue';
    if (diff <= 2) return 'kb-deadline-urgent';
    if (diff <= 7) return 'kb-deadline-soon';
    return '';
  },

  _slugify(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').replace(/\s+/g,'_').replace(/[^a-z0-9_]/gi,'').toLowerCase();
  },

  _onKanbanSearch(q) {
    clearTimeout(this._kanbanSearchTimer);
    this._kanbanSearchTimer = setTimeout(() => this._renderKanbanBoard(q), 200);
  },

  // ── Drag & Drop ──────────────────────────────────────────────
  _stopDragScroll() {
    if (this._dragScrollInterval) {
      clearInterval(this._dragScrollInterval);
      this._dragScrollInterval = null;
    }
  },

  _setupKanbanDnD() { 
    this._draggingDon = null; 
    this._stopDragScroll();
    this._currentDragSpeed = 0;

    const board = document.getElementById('kb-board');
    if (!board) return;

    this._onDragOverBoard = (ev) => {
      const rect = board.getBoundingClientRect();
      const x = ev.clientX;
      const EDGE = 150; // pixels from edge to trigger scroll
      let speed = 0;

      if (x > rect.right - EDGE) {
        speed = ((x - (rect.right - EDGE)) / EDGE) * 25;
      } else if (x < rect.left + EDGE) {
        speed = -((((rect.left + EDGE) - x) / EDGE) * 25);
      }

      if (speed !== 0) {
        this._currentDragSpeed = speed;
        if (!this._dragScrollInterval) {
          this._dragScrollInterval = setInterval(() => {
            if (board) board.scrollLeft += this._currentDragSpeed;
          }, 16);
        }
      } else {
        this._stopDragScroll();
      }
    };

    board.addEventListener('dragover', this._onDragOverBoard);
    board.addEventListener('drop', () => this._stopDragScroll());
    board.addEventListener('dragleave', (ev) => {
       const rect = board.getBoundingClientRect();
       if (ev.clientX <= rect.left || ev.clientX >= rect.right || ev.clientY <= rect.top || ev.clientY >= rect.bottom) {
          this._stopDragScroll();
       }
    });
  },

  _onDragStart(ev, maDon) {
    this._draggingDon = maDon;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', maDon);
    setTimeout(() => ev.target.classList.add('kb-card-dragging'), 0);
  },

  _onDragEnd(ev) { 
    ev.target.classList.remove('kb-card-dragging'); 
    this._stopDragScroll();
  },
  _onDragLeave(ev) { ev.currentTarget.classList.remove('kb-col-over'); },

  _onDragOver(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    ev.currentTarget.classList.add('kb-col-over');
  },

  _getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.kb-card:not(.kb-card-dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  },

  async _onDrop(ev, newCol) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('kb-col-over');
    const maDon = this._draggingDon || ev.dataTransfer.getData('text/plain');
    if (!maDon) return;

    const don = (this._kanbanData || []).find(d => d.ma_don === maDon);
    if (!don) return;
    if (don.trang_thai && don.trang_thai.toLowerCase().startsWith('hủy')) return;

    const container = ev.currentTarget.querySelector('.kb-col-body');
    const afterElement = this._getDragAfterElement(container, ev.clientY);

    const oldCol = don.cot_kanban;
    const oldThuTu = don.thu_tu;

    let newThuTu = 0;
    let colCards = (this._kanbanData || []).filter(d => d.cot_kanban === newCol && d.ma_don !== maDon);
    colCards.sort((a, b) => {
       const orderA = (a.thu_tu !== undefined && a.thu_tu !== '') ? parseFloat(a.thu_tu) : 0;
       const orderB = (b.thu_tu !== undefined && b.thu_tu !== '') ? parseFloat(b.thu_tu) : 0;
       return orderA - orderB;
    });

    if (afterElement) {
       const afterMaDon = afterElement.getAttribute('data-don');
       const afterIndex = colCards.findIndex(d => d.ma_don === afterMaDon);
       if (afterIndex === 0) {
          newThuTu = (parseFloat(colCards[0].thu_tu) || 0) - 1000;
       } else if (afterIndex > 0) {
          const prevThuTu = parseFloat(colCards[afterIndex - 1].thu_tu) || 0;
          const nextThuTu = parseFloat(colCards[afterIndex].thu_tu) || 0;
          newThuTu = (prevThuTu + nextThuTu) / 2;
       }
    } else {
       if (colCards.length === 0) {
          newThuTu = 1000;
       } else {
          newThuTu = (parseFloat(colCards[colCards.length - 1].thu_tu) || 0) + 1000;
       }
    }

    if (don.cot_kanban === newCol && don.thu_tu == newThuTu) return;

    don.cot_kanban = newCol;
    don.thu_tu = newThuTu;

    this._renderKanbanBoard(document.getElementById('kb-search-input')?.value || '');

    try {
      await this._kanbanUpdateCotKanbanVaThuTu(maDon, newCol, newThuTu);
      this._showToast(`✅ Cập nhật vị trí ${maDon}`, 'success', 2500);
    } catch (e) {
      don.cot_kanban = oldCol;
      don.thu_tu = oldThuTu;
      this._renderKanbanBoard(document.getElementById('kb-search-input')?.value || '');
      this._showToast(`Lỗi cập nhật: ${e.message}`, 'error');
    }
  },

  async _kanbanUpdateCotKanbanVaThuTu(maDon, newCol, newThuTu) {
    const rows = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_ETSY || 'DON_ETSY');
    const idx  = rows.findIndex(r => r.ma_don === maDon);
    if (idx === -1) throw new Error('Không tìm thấy đơn ' + maDon);

    const headerRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY' + '!1:1')}`,
      { headers: { Authorization: `Bearer ${this.session.accessToken}` } }
    );
    const headerData = await headerRes.json();
    const headers = (headerData.values || [[]])[0] || [];
    
    const colIdx = headers.indexOf('cot_kanban');
    const thuTuIdx = headers.indexOf('thu_tu');
    
    if (colIdx === -1) throw new Error('Thiếu cột cot_kanban trong Sheets');
    if (thuTuIdx === -1) throw new Error('Thiếu cột thu_tu trong Sheets');

    const colLetter = this._colIndexToLetter(colIdx);
    const thuTuLetter = this._colIndexToLetter(thuTuIdx);
    const sheetRow  = idx + 2;

    await Promise.all([
      this._writeSheet(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', `${colLetter}${sheetRow}`, [[newCol]]),
      this._writeSheet(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', `${thuTuLetter}${sheetRow}`, [[newThuTu]])
    ]);
  },

  _colIndexToLetter(idx) {
    let result = '';
    idx = idx + 1;
    while (idx > 0) {
      const rem = (idx - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      idx = Math.floor((idx - 1) / 26);
    }
    return result;
  },

  // ── Card Detail Popup ─────────────────────────────────────────
  _formatDatetimeLocal(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '';
    let dStr = '', tStr = '';
    const dateTrim = dateStr.trim();
    if (!dateTrim) return '';
    
    if (dateTrim.includes('T')) {
       const isoParts = dateTrim.split('T');
       dStr = isoParts[0];
       tStr = isoParts[1] || '00:00';
    } else {
       const parts = dateTrim.split(/\s+/);
       dStr = parts[0];
       tStr = parts[1] || '00:00';
    }
    
    let y, m, d;
    if (dStr.includes('/')) {
       [d, m, y] = dStr.split('/');
    } else if (dStr.includes('-')) {
       [y, m, d] = dStr.split('-');
    } else {
       return '';
    }
    
    if (!y || !m || !d) return '';
    if (y.length === 2) y = '20' + y;
    
    y = y.padStart(4, '0');
    m = m.padStart(2, '0');
    d = d.padStart(2, '0');
    
    let [hh, mm] = tStr.split(':');
    if (!hh) hh = '00';
    if (!mm) mm = '00';
    hh = hh.padStart(2, '0');
    mm = mm.padStart(2, '0');
    
    const hour = parseInt(hh, 10);
    const minute = parseInt(mm, 10);
    if (isNaN(hour) || hour > 23 || hour < 0) hh = '00';
    if (isNaN(minute) || minute > 59 || minute < 0) mm = '00';
    
    return `${y}-${m}-${d}T${hh}:${mm}`;
  },

  _deadlineClass(dateStr) {
    const iso = this._formatDatetimeLocal(dateStr);
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d)) return '';
    const now = new Date();
    const diff = (d - now) / (1000 * 60 * 60 * 24);
    if (diff < 0)  return 'kb-deadline-overdue';
    if (diff <= 2) return 'kb-deadline-urgent';
    if (diff <= 7) return 'kb-deadline-soon';
    return '';
  },

  _slugify(str) {
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd').replace(/\s+/g,'_').replace(/[^a-z0-9_]/gi,'').toLowerCase();
  },

  _onKanbanSearch(q) {
    clearTimeout(this._kanbanSearchTimer);
    this._kanbanSearchTimer = setTimeout(() => this._renderKanbanBoard(q), 200);
  },

  // ── Drag & Drop ──────────────────────────────────────────────
  _stopDragScroll() {
    if (this._dragScrollInterval) {
      clearInterval(this._dragScrollInterval);
      this._dragScrollInterval = null;
    }
  },

  _setupKanbanDnD() { 
    this._draggingDon = null; 
    this._stopDragScroll();
    this._currentDragSpeed = 0;

    const board = document.getElementById('kb-board');
    if (!board) return;

    this._onDragOverBoard = (ev) => {
      const rect = board.getBoundingClientRect();
      const x = ev.clientX;
      const EDGE = 150; // pixels from edge to trigger scroll
      let speed = 0;

      if (x > rect.right - EDGE) {
        speed = ((x - (rect.right - EDGE)) / EDGE) * 25;
      } else if (x < rect.left + EDGE) {
        speed = -((((rect.left + EDGE) - x) / EDGE) * 25);
      }

      if (speed !== 0) {
        this._currentDragSpeed = speed;
        if (!this._dragScrollInterval) {
          this._dragScrollInterval = setInterval(() => {
            if (board) board.scrollLeft += this._currentDragSpeed;
          }, 16);
        }
      } else {
        this._stopDragScroll();
      }
    };

    board.addEventListener('dragover', this._onDragOverBoard);
    board.addEventListener('drop', () => this._stopDragScroll());
    board.addEventListener('dragleave', (ev) => {
       const rect = board.getBoundingClientRect();
       if (ev.clientX <= rect.left || ev.clientX >= rect.right || ev.clientY <= rect.top || ev.clientY >= rect.bottom) {
          this._stopDragScroll();
       }
    });
  },

  _onDragStart(ev, maDon) {
    this._draggingDon = maDon;
    ev.dataTransfer.effectAllowed = 'move';
    ev.dataTransfer.setData('text/plain', maDon);
    setTimeout(() => ev.target.classList.add('kb-card-dragging'), 0);
  },

  _onDragEnd(ev) { 
    ev.target.classList.remove('kb-card-dragging'); 
    this._stopDragScroll();
  },
  _onDragLeave(ev) { ev.currentTarget.classList.remove('kb-col-over'); },

  _onDragOver(ev) {
    ev.preventDefault();
    ev.dataTransfer.dropEffect = 'move';
    ev.currentTarget.classList.add('kb-col-over');
  },

  _getDragAfterElement(container, y) {
    const draggableElements = [...container.querySelectorAll('.kb-card:not(.kb-card-dragging)')];
    return draggableElements.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset: offset, element: child };
      } else {
        return closest;
      }
    }, { offset: Number.NEGATIVE_INFINITY }).element;
  },

  async _onDrop(ev, newCol) {
    ev.preventDefault();
    ev.currentTarget.classList.remove('kb-col-over');
    const maDon = this._draggingDon || ev.dataTransfer.getData('text/plain');
    if (!maDon) return;

    const don = (this._kanbanData || []).find(d => d.ma_don === maDon);
    if (!don) return;
    if (don.trang_thai && don.trang_thai.toLowerCase().startsWith('hủy')) return;

    const container = ev.currentTarget.querySelector('.kb-col-body');
    const afterElement = this._getDragAfterElement(container, ev.clientY);

    const oldCol = don.cot_kanban;
    const oldThuTu = don.thu_tu;

    let newThuTu = 0;
    let colCards = (this._kanbanData || []).filter(d => d.cot_kanban === newCol && d.ma_don !== maDon);
    colCards.sort((a, b) => {
       const orderA = (a.thu_tu !== undefined && a.thu_tu !== '') ? parseFloat(a.thu_tu) : 0;
       const orderB = (b.thu_tu !== undefined && b.thu_tu !== '') ? parseFloat(b.thu_tu) : 0;
       return orderA - orderB;
    });

    if (afterElement) {
       const afterMaDon = afterElement.getAttribute('data-don');
       const afterIndex = colCards.findIndex(d => d.ma_don === afterMaDon);
       if (afterIndex === 0) {
          newThuTu = (parseFloat(colCards[0].thu_tu) || 0) - 1000;
       } else if (afterIndex > 0) {
          const prevThuTu = parseFloat(colCards[afterIndex - 1].thu_tu) || 0;
          const nextThuTu = parseFloat(colCards[afterIndex].thu_tu) || 0;
          newThuTu = (prevThuTu + nextThuTu) / 2;
       }
    } else {
       if (colCards.length === 0) {
          newThuTu = 1000;
       } else {
          newThuTu = (parseFloat(colCards[colCards.length - 1].thu_tu) || 0) + 1000;
       }
    }

    if (don.cot_kanban === newCol && don.thu_tu == newThuTu) return;

    don.cot_kanban = newCol;
    don.thu_tu = newThuTu;

    this._renderKanbanBoard(document.getElementById('kb-search-input')?.value || '');

    try {
      await this._kanbanUpdateCotKanbanVaThuTu(maDon, newCol, newThuTu);
      this._showToast(`✅ Cập nhật vị trí ${maDon}`, 'success', 2500);
    } catch (e) {
      don.cot_kanban = oldCol;
      don.thu_tu = oldThuTu;
      this._renderKanbanBoard(document.getElementById('kb-search-input')?.value || '');
      this._showToast(`Lỗi cập nhật: ${e.message}`, 'error');
    }
  },

  async _kanbanUpdateCotKanbanVaThuTu(maDon, newCol, newThuTu) {
    const rows = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_ETSY || 'DON_ETSY');
    const idx  = rows.findIndex(r => r.ma_don === maDon);
    if (idx === -1) throw new Error('Không tìm thấy đơn ' + maDon);

    const headerRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY' + '!1:1')}`,
      { headers: { Authorization: `Bearer ${this.session.accessToken}` } }
    );
    const headerData = await headerRes.json();
    const headers = (headerData.values || [[]])[0] || [];
    
    const colIdx = headers.indexOf('cot_kanban');
    const thuTuIdx = headers.indexOf('thu_tu');
    
    if (colIdx === -1) throw new Error('Thiếu cột cot_kanban trong Sheets');
    if (thuTuIdx === -1) throw new Error('Thiếu cột thu_tu trong Sheets');

    const colLetter = this._colIndexToLetter(colIdx);
    const thuTuLetter = this._colIndexToLetter(thuTuIdx);
    const sheetRow  = idx + 2;

    await Promise.all([
      this._writeSheet(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', `${colLetter}${sheetRow}`, [[newCol]]),
      this._writeSheet(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', `${thuTuLetter}${sheetRow}`, [[newThuTu]])
    ]);
  },

  _colIndexToLetter(idx) {
    let result = '';
    idx = idx + 1;
    while (idx > 0) {
      const rem = (idx - 1) % 26;
      result = String.fromCharCode(65 + rem) + result;
      idx = Math.floor((idx - 1) / 26);
    }
    return result;
  },

  // ── Card Detail Popup ─────────────────────────────────────────
  _openCardDetail(maDon) {
    const existing = document.getElementById('kb-detail-overlay');
    if (existing) existing.remove();

    const don = this._kanbanData.find(d => d.ma_don === maDon);
    if (!don) return;

    const isDesigner  = this.session?.role === 'designer';
    const isSaleAdmin = !isDesigner; 

    // File links
    const linkLines = (don.link_anh_kh || don.link_anh || '').split('\n').filter(Boolean);
    const linksHtml = linkLines.length > 0
      ? linkLines.map((url, i) => {
          const name  = url.match(/\/([^/]+)\/(view|preview|download)?$/)?.[1] || `File ${i+1}`;
          const isImg = /\.(jpg|jpeg|png|gif|webp|svg)/i.test(url);
          return isImg
            ? `<a href="${this._escHtml(url)}" target="_blank" class="kb-detail-file kb-detail-img-link">
                 <img src="${this._escHtml(url.replace('view','preview'))}" alt="${i+1}" onerror="this.style.display='none'"/>
                 <span>${this._escHtml(name)}</span>
               </a>`
            : `<a href="${this._escHtml(url)}" target="_blank" class="kb-detail-file">
                 <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                 ${this._escHtml(decodeURIComponent(name))}
               </a>`;
        }).join('')
      : `<p style="color:var(--clr-text-muted);font-size:var(--font-size-sm);">Chưa có file đính kèm.</p>`;

    // Dropdowns
    const colOpts = this.KANBAN_COLS.map(c =>
      `<option value="${this._escHtml(c)}"${don.cot_kanban === c ? ' selected' : ''}>${this._escHtml(c)}</option>`
    ).join('');

    const turnOpts = ['12h','24h','36h','48h','3 days','4 days'].map(s => 
      `<option value="${s}"${don.turnaround === s ? ' selected' : ''}>${s}</option>`
    ).join('');

    const overlay = document.createElement('div');
    overlay.id = 'kb-detail-overlay';
    overlay.className = 'kb-overlay';

    // ── Comments ────────────────────────────────────────────
    const donComments = (this._commentList || []).filter(c => c.ma_don === maDon);
    let commentsHtml = donComments.map(c => `
      <div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--clr-border);">
        <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
          <strong style="font-size:12px; color:var(--clr-text);">${this._escHtml(c.nguoi || 'Ẩn danh')}</strong>
          <span style="font-size:10px; color:var(--clr-text-muted);">${this._escHtml(c.thoi_gian || '')}</span>
        </div>
        <div style="font-size:12px; white-space:pre-wrap; line-height:1.4;">${this._linkifyText(c.noi_dung || '')}</div>
      </div>
    `).join('');

    if (donComments.length === 0) {
      commentsHtml = `<div style="font-size:11px; color:var(--clr-text-muted); font-style:italic;">Chưa có trao đổi nào.</div>`;
    }

    const commentSection = `
      <div class="kb-detail-section" style="margin-top:24px;">
        <div class="kb-detail-section-title">Trao đổi</div>
        <div id="det-comment-list" style="max-height:250px; overflow-y:auto; padding-right:4px; margin-bottom:8px;">
          ${commentsHtml}
        </div>
        <div style="display:flex; flex-direction:column; gap:8px;">
          <textarea id="det-comment-input" class="form-textarea" rows="2" placeholder="Nhập bình luận..." style="font-size:12px;"></textarea>
          <button class="btn btn-primary btn-sm" style="align-self:flex-end;" onclick="App._submitComment('${this._escHtml(maDon)}')">Gửi</button>
        </div>
      </div>
    `;

    
    // Header tags
    let tagsHtml = '';
    const myLabels = this._kanbanLabelMap[maDon] || [];
    if (myLabels.length > 0) {
      tagsHtml += myLabels.map(lbl => `<span class="kb-card-tag" style="background:${lbl.mau}20;color:${lbl.mau};">${this._escHtml(lbl.nhan)}</span>`).join('');
    }

    const modalHtml = `
      <div class="kb-detail-modal">
        <div class="kb-detail-header">
          <div>
            <div class="kb-detail-id">${this._escHtml(don.ma_don || 'Đơn hàng')}
              ${tagsHtml ? `<div style="margin-left:8px; display:inline-flex; gap:4px; align-items:center;">${tagsHtml}</div>` : ''}
            </div>
            <div class="kb-detail-khach">${this._escHtml(don.buyer_name || don.ten_khach || '')}${don.shop ? ' · ' + this._escHtml(don.shop) : ''}</div>
          </div>
          <button class="kb-detail-close" onclick="App._closeCardDetail()">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        <div class="kb-detail-body">
          <!-- Cột trái -->
          <div class="kb-detail-left">
            <div class="kb-detail-section">
              <div class="kb-detail-section-title">Personalization</div>
              <textarea class="form-textarea" id="det-personalization" rows="6" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''}>${this._escHtml(don.personalization || '')}</textarea>
            </div>

            <details class="kb-detail-section kb-collapse-section">
              <summary class="kb-detail-section-title kb-collapse-summary">Thông tin đơn</summary>
              <div class="kb-detail-grid" style="margin-top: 12px;">
                
                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Mã order Etsy</label>
                  <input class="form-input" id="det-ma-order" value="${this._escHtml(don.ma_order_etsy || '')}" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''} />
                </div>

                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Tên người mua</label>
                  <input class="form-input" id="det-buyer-name" value="${this._escHtml(don.buyer_name || don.ten_khach || '')}" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''} />
                </div>

                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Email người mua</label>
                  <input class="form-input" id="det-buyer-email" value="${this._escHtml(don.buyer_email || '')}" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''} />
                </div>

                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Shop</label>
                  <input class="form-input" id="det-shop" value="${this._escHtml(don.shop || '')}" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''} />
                </div>

                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Loại</label>
                  <input class="form-input" id="det-loai" value="${this._escHtml(don.loai || '')}" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''} />
                </div>

                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Item Name</label>
                  <input class="form-input" id="det-item-name" value="${this._escHtml(don.item_name || '')}" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''} />
                </div>

                <div class="kb-detail-field-group">
                  <label class="kb-detail-label">Turnaround</label>
                  ${isDesigner ? 
                    `<input type="text" class="form-input" readonly value="${this._escHtml(don.turnaround || '')}" style="font-size:var(--font-size-sm);" />` :
                    `<select class="form-select" id="det-turnaround" style="font-size:var(--font-size-sm);">
                       <option value="">Chọn turnaround</option>
                       ${turnOpts}
                     </select>`
                  }
                </div>

              </div>
            </details>

            <div class="kb-detail-section">
              <div class="kb-detail-section-title">Nội dung email trả lời</div>
              <textarea class="form-textarea" id="det-noi-dung-email" rows="12" style="font-size:var(--font-size-sm);" ${isDesigner?'readonly':''}>${this._escHtml(don.noi_dung_email || '')}</textarea>
            </div>
            
            <div class="kb-detail-section">
              <div class="kb-detail-section-title">
                File đính kèm (${linkLines.length})
              </div>
              <div class="kb-detail-files">
                ${linksHtml}
              </div>
              <div class="upload-zone" id="upload-zone-detail" style="margin-top: 12px; padding: 12px;">
                <input type="file" id="file-input-chi-tiet" multiple style="display:none;" onchange="App._onFileSelected(this, 'chi-tiet')" />
                <div class="upload-zone-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg></div>
                <p style="font-size: 11px;"><strong>Click</strong> hoặc kéo thả file để đính thêm</p>
              </div>
              <div id="upload-preview-grid-chi-tiet" class="upload-preview-grid"></div>
              <div id="upload-progress-container-chi-tiet" style="display:none;margin-top:12px;">
                <div class="upload-progress-bar"><div class="upload-progress-fill" id="upload-progress-fill-chi-tiet" style="width:0%"></div></div>
                <p class="upload-status-text" id="upload-status-text-chi-tiet">Đang chuẩn bị...</p>
              </div>
            </div>

          </div>

          <!-- Cột phải -->
          <div class="kb-detail-right">
            ${(() => {
              const assignedDesigners = this._kanbanDesignerMap?.[maDon] || [];
              const designerScores = this._kanbanDesignerScoreMap?.[maDon] || {};
              const designerStaff = (this._nhanSuList || []).filter(n => n.vai_tro === 'designer').map(n => n.ten || n.ho_ten || n.ten_nhan_vien || n.email || '');
              const isAdmin = this.session?.role === 'admin';
              const availableDesigners = designerStaff.filter(d => d && !assignedDesigners.includes(d));
              
              if (isAdmin) {
                let totalScore = 0;
                const tagsHtml = assignedDesigners.map(d => {
                   const diem = designerScores[d] || '';
                   const val = parseFloat(diem.toString().replace(/,/g, '.'));
                   if (!isNaN(val)) totalScore += val;
                   
                   const removeBtn = isAdmin ? `<svg onclick="this.parentElement.remove(); App._updateDesignerSelect(); App._calculateTotalScore();" style="cursor:pointer;color:#E74C3C;margin-left:4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>` : '';
                   const scoreInput = `<div style="display:flex; align-items:center; gap:2px; margin-left:8px; background:#fff; padding:2px 4px; border-radius:4px; border:1px solid var(--clr-border);">
                     <span style="font-size:10px; font-weight:600; color:var(--clr-text-muted);">Điểm:</span>
                     <input type="text" class="det-designer-score" name="designer_score_${this._escHtml(d)}" value="${this._escHtml(diem)}" placeholder="0" style="width:30px; height:16px; font-size:11px; font-weight:bold; text-align:center; border:none; outline:none; background:transparent;" oninput="App._calculateTotalScore()" />
                   </div>`;
          
                   return `
                      <span class="kb-tag" style="display:inline-flex;align-items:center;padding:4px 8px;background:var(--clr-bg);border:1px solid var(--clr-primary);border-radius:6px;width:fit-content;">
                        <strong style="font-size:12px;color:var(--clr-text);">${this._escHtml(d)}</strong>
                        ${scoreInput}
                        <input type="hidden" name="assigned_designer" value="${this._escHtml(d)}" />
                        ${removeBtn}
                      </span>
                   `;
                }).join('');
          
                return `
                  <div class="kb-detail-sidebar-group" style="margin-bottom:16px;">
                    <div class="kb-detail-sidebar-title">Designers phụ trách</div>
                    <div id="det-designer-tags" style="display:flex; flex-direction:column; gap:6px; margin-bottom:12px;">
                      ${tagsHtml}
                    </div>
                    ${isAdmin ? `
                    <select class="form-select" id="det-designer-select" style="font-size:12px; padding:6px; width:100%; border:1px dashed var(--clr-border);" onchange="App._onDesignerSelect(this)">
                      <option value="">+ Chọn designer...</option>
                      ${availableDesigners.map(d => `<option value="${this._escHtml(d)}">${this._escHtml(d)}</option>`).join('')}
                    </select>` : ''}
                    <div style="font-size:12px; font-weight:600; text-align:right; color:var(--clr-text); margin-top:8px;">
                      Tổng điểm: <span id="det-total-score">${Number(totalScore.toFixed(2))}</span>
                    </div>
                  </div>
                `;
              } else {
                let currentUser = this.session?.email || '';
                if (this._nhanSuList) {
                  const ns = this._nhanSuList.find(n => n.email === currentUser);
                  if (ns) currentUser = ns.ho_ten || ns.ten_nhan_vien || ns.ten || ns.ten_designer || ns.designer || currentUser;
                }
                let diemHtml = '';
                if (assignedDesigners.includes(currentUser)) {
                   diemHtml = `<div style="font-size:12px; color:var(--clr-primary); font-weight:600; margin-top:4px;">Điểm của bạn: ${designerScores[currentUser] || 0}</div>`;
                }
                return `
                  <div class="kb-detail-sidebar-group" style="margin-bottom:16px;">
                    <div class="kb-detail-sidebar-title">Designers phụ trách</div>
                    <div style="font-size:12px;">${assignedDesigners.join(', ') || 'Chưa phân công'}</div>
                    ${diemHtml}
                  </div>
                `;
              }
            })()}

            ${isSaleAdmin ? `
              <div class="kb-detail-sidebar-group">
                <div class="kb-detail-sidebar-title">Tiến độ</div>
                <select class="form-select" id="det-cot-kanban">
                  ${colOpts}
                </select>
              </div>
            ` : `
              <div class="kb-detail-sidebar-group">
                <div class="kb-detail-sidebar-title">Tiến độ hiện tại</div>
                <div class="kb-detail-value" style="font-weight:600; color:var(--clr-primary);">${this._escHtml(don.cot_kanban || 'Chưa có')}</div>
              </div>
            `}
            ${commentSection}
          </div>
        </div>

        <div class="kb-detail-footer">
          ${isDesigner ? '' : `
          <button class="btn btn-primary" id="btn-save-detail" onclick="App._saveCardDetail('${this._escHtml(maDon)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
            Lưu thay đổi
          </button>
          `}
        </div>
        </div>
      </div>`;

    if (!this._uploadFilesMap) this._uploadFilesMap = {};
    this._uploadFilesMap['chi-tiet'] = [];

    overlay.innerHTML = modalHtml;
    document.body.appendChild(overlay);
    this._setupUploadDragDropDetail();
    
    overlay.addEventListener('click', e => { if (e.target === overlay) this._closeCardDetail(); });
    requestAnimationFrame(() => overlay.classList.add('kb-overlay-visible'));
  },
  async _saveCardDetail(maDon) {
    const btn = document.getElementById('btn-save-detail');
    if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Đang lưu...'; }

    const isDesigner = this.session?.role === 'designer';

    const patch = {
      ma_order_etsy:   document.getElementById('det-ma-order')?.value.trim(),
      buyer_name:      document.getElementById('det-buyer-name')?.value.trim(),
      buyer_email:     document.getElementById('det-buyer-email')?.value.trim(),
      shop:            document.getElementById('det-shop')?.value.trim(),
      loai:            document.getElementById('det-loai')?.value.trim(),
      item_name:       document.getElementById('det-item-name')?.value.trim(),
      personalization: document.getElementById('det-personalization')?.value.trim(),
      turnaround:      document.getElementById('det-turnaround')?.value.trim(),
      noi_dung_email:  document.getElementById('det-noi-dung-email')?.value.trim(),
      ...(isDesigner ? {} : {
        cot_kanban:    document.getElementById('det-cot-kanban')?.value,
        designer:      document.getElementById('det-designer-tags') ? Array.from(document.querySelectorAll('input[name="assigned_designer"]')).map(el => el.value).join(', ') : undefined,
      }),
    };

    const don = this._kanbanData.find(d => d.ma_don === maDon);
    if (!don) throw new Error('Không tìm thấy đơn ' + maDon);

    const prog = document.getElementById('upload-progress-container-chi-tiet');
    if (prog) prog.style.display = 'block';
    const uploadedUrls = await this._uploadAnhLenDrive(this._uploadFilesMap?.['chi-tiet'] || [], maDon);
    if (prog) prog.style.display = 'none';

    if (uploadedUrls.length > 0) {
      const driveLinks = uploadedUrls.join('\n');
      patch.link_anh_kh = don.link_anh_kh ? don.link_anh_kh + '\n' + driveLinks : driveLinks;
    }

    try {
      const rows = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.DON_ETSY || 'DON_ETSY');
      const rowIdx = rows.findIndex(r => r.ma_don === maDon);
      if (rowIdx === -1) throw new Error('Không tìm thấy đơn ' + maDon);

      const headerRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SPREADSHEET_ID}/values/${encodeURIComponent(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY' + '!1:1')}`,
        { headers: { Authorization: `Bearer ${this.session.accessToken}` } }
      );
      const hData = await headerRes.json();
      const headers = (hData.values || [[]])[0] || [];
      const sheetRow = rowIdx + 2;

      const writes = Object.entries(patch).map(([key, val]) => {
        const colIdx = headers.indexOf(key);
        if (colIdx === -1 || val === undefined) return null;
        const col = this._colIndexToLetter(colIdx);
        return this._writeSheet(CONFIG.SHEETS.DON_ETSY || 'DON_ETSY', `${col}${sheetRow}`, [[val]]);
      }).filter(Boolean);

      await Promise.all(writes);

      // Update DIEM_DESIGNER (admin/leader/sale only)
      const isRoleSaleAdmin = ['admin', 'leader', 'sale'].includes(this.session?.role);
      if (isRoleSaleAdmin && document.getElementById('det-designer-tags')) {
        const assignedDesigners = Array.from(document.querySelectorAll('input[name="assigned_designer"]')).map(el => el.value);
        
        const scoreInputs = {};
        assignedDesigners.forEach(d => {
           const inp = document.querySelector(`input[name="designer_score_${d}"]`);
           if (inp) {
              scoreInputs[d] = inp.value.replace(/,/g, '.').replace(/[^0-9.]/g, '').trim();
           }
        });

        const rawDiem = await this._readSheet(this.session.accessToken, CONFIG.SHEETS.DIEM_DESIGNER).catch(() => []);
        
        const rowsForDon = [];
        rawDiem.forEach((row, idx) => {
          if (row.ma_don === maDon) rowsForDon.push({ ...row, rowIndex: idx + 2 });
        });

        const oldDesigners = rowsForDon.map(r => r.ten_designer || r.designer || r.ho_ten || r.ten || '');
        
        const toRemove = rowsForDon.filter(r => {
          const t = r.ten_designer || r.designer || r.ho_ten || r.ten || '';
          return !assignedDesigners.includes(t);
        });
        
        const toAdd = assignedDesigners.filter(d => !oldDesigners.includes(d));

        const toUpdateScore = rowsForDon.filter(r => {
          const t = r.ten_designer || r.designer || r.ho_ten || r.ten || '';
          if (!assignedDesigners.includes(t)) return false;
          const newScore = scoreInputs[t] || '';
          const oldScore = r.diem || '';
          return newScore !== oldScore;
        });

        const diemWrites = [];

        for (const r of toRemove) {
          diemWrites.push(this._writeSheet(CONFIG.SHEETS.DIEM_DESIGNER, `A${r.rowIndex}:C${r.rowIndex}`, [['', '', '']]));
        }
        
        if (toAdd.length > 0) {
          const appendData = toAdd.map(d => [maDon, d, scoreInputs[d] || '']);
          diemWrites.push(this._appendSheet(CONFIG.SHEETS.DIEM_DESIGNER, appendData));
        }

        for (const r of toUpdateScore) {
          const t = r.ten_designer || r.designer || r.ho_ten || r.ten || '';
          const newScore = scoreInputs[t] || '';
          diemWrites.push(this._writeSheet(CONFIG.SHEETS.DIEM_DESIGNER, `C${r.rowIndex}`, [[newScore]]));
        }
        
        if (diemWrites.length > 0) {
           await Promise.all(diemWrites);
        }
        
        this._kanbanDesignerMap[maDon] = assignedDesigners;
        if (!this._kanbanDesignerScoreMap) this._kanbanDesignerScoreMap = {};
        if (!this._kanbanDesignerScoreMap[maDon]) this._kanbanDesignerScoreMap[maDon] = {};
        assignedDesigners.forEach(d => {
           this._kanbanDesignerScoreMap[maDon][d] = scoreInputs[d] || '';
        });
      }

      Object.assign(don, patch);

      this._showToast(`✅ Đã lưu thay đổi cho ${maDon}`, 'success', 3000);
      this._renderKanbanBoard(document.getElementById('kb-search-input')?.value || '');
      this._openCardDetail(maDon);
    } catch (e) {
      this._showToast('Lỗi lưu: ' + e.message, 'error');
      if (btn) { btn.disabled = false; btn.innerHTML = 'Lưu thay đổi'; }
    }
  },

  async _submitComment(maDon) {
    const input = document.getElementById('det-comment-input');
    const btn = input.nextElementSibling;
    const noiDung = input.value.trim();
    if (!noiDung) return;

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner" style="width:12px;height:12px;border-width:2px;"></span> Đang gửi...';

    try {
      const email = this.session?.email;
      let nguoi = email;
      if (this._nhanSuList) {
        const ns = this._nhanSuList.find(n => n.email === email);
        if (ns && (ns.ho_ten || ns.ten_nhan_vien || ns.ten || ns.ten_designer || ns.designer)) {
           nguoi = ns.ho_ten || ns.ten_nhan_vien || ns.ten || ns.ten_designer || ns.designer;
        }
      }
      
      const now = new Date();
      const dd = String(now.getDate()).padStart(2, '0');
      const mm = String(now.getMonth() + 1).padStart(2, '0');
      const yy = now.getFullYear();
      const hh = String(now.getHours()).padStart(2, '0');
      const min = String(now.getMinutes()).padStart(2, '0');
      const thoiGian = `${dd}/${mm}/${yy} ${hh}:${min}`;

      await this._appendSheet(CONFIG.SHEETS.COMMENT, [[ maDon, nguoi, thoiGian, noiDung ]]);

      const newComment = { ma_don: maDon, nguoi, thoi_gian: thoiGian, noi_dung: noiDung };
      if (!this._commentList) this._commentList = [];
      this._commentList.push(newComment);

      const listDiv = document.getElementById('det-comment-list');
      if (listDiv) {
        if (listDiv.innerHTML.includes('Chưa có trao đổi nào')) listDiv.innerHTML = '';
        listDiv.innerHTML += `
          <div style="margin-bottom:8px; padding-bottom:8px; border-bottom:1px solid var(--clr-border);">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px;">
              <strong style="font-size:12px; color:var(--clr-text);">${this._escHtml(nguoi)}</strong>
              <span style="font-size:10px; color:var(--clr-text-muted);">${this._escHtml(thoiGian)}</span>
            </div>
            <div style="font-size:12px; white-space:pre-wrap; line-height:1.4;">${this._linkifyText(noiDung)}</div>
          </div>
        `;
        listDiv.scrollTop = listDiv.scrollHeight;
      }
      input.value = '';
    } catch (e) {
      this._showToast('Lỗi gửi comment: ' + e.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = 'Gửi';
    }
  },

  _onDesignerSelect(selectEl) {
    const val = selectEl.value;
    if (!val) return;
    const container = document.getElementById('det-designer-tags');
    const span = document.createElement('span');
    span.className = 'kb-tag';
    span.style.cssText = 'display:inline-flex;align-items:center;padding:4px 8px;background:var(--clr-bg);border:1px solid var(--clr-primary);border-radius:6px;width:fit-content;';
    
    const removeBtn = `<svg onclick="this.parentElement.remove(); App._updateDesignerSelect(); App._calculateTotalScore();" style="cursor:pointer;color:#E74C3C;margin-left:4px;" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;
    const scoreInput = `<div style="display:flex; align-items:center; gap:2px; margin-left:8px; background:#fff; padding:2px 4px; border-radius:4px; border:1px solid var(--clr-border);">
      <span style="font-size:10px; font-weight:600; color:var(--clr-text-muted);">Điểm:</span>
      <input type="text" class="det-designer-score" name="designer_score_${this._escHtml(val)}" value="" placeholder="0" style="width:30px; height:16px; font-size:11px; font-weight:bold; text-align:center; border:none; outline:none; background:transparent;" oninput="App._calculateTotalScore()" />
    </div>`;

    span.innerHTML = `
      <strong style="font-size:12px;color:var(--clr-text);">${this._escHtml(val)}</strong>
      ${scoreInput}
      <input type="hidden" name="assigned_designer" value="${this._escHtml(val)}" />
      ${removeBtn}
    `;
    container.appendChild(span);
    this._updateDesignerSelect();
  },

  _updateDesignerSelect() {
    const assigned = Array.from(document.querySelectorAll('input[name="assigned_designer"]')).map(el => el.value);
    const selectEl = document.getElementById('det-designer-select');
    if (!selectEl) return;
    const allDesigners = (this._nhanSuList || []).filter(n => n.vai_tro === 'designer').map(n => n.ten || n.ho_ten || n.ten_nhan_vien || n.email || '');
    const available = allDesigners.filter(d => d && !assigned.includes(d));
    selectEl.innerHTML = `<option value="">+ Chọn designer...</option>` + available.map(d => `<option value="${this._escHtml(d)}">${this._escHtml(d)}</option>`).join('');
  },

  _calculateTotalScore() {
    const totalEl = document.getElementById('det-total-score');
    if (!totalEl) return;
    let totalScore = 0;
    document.querySelectorAll('.det-designer-score').forEach(inp => {
       const val = parseFloat(inp.value.toString().replace(/,/g, '.'));
       if (!isNaN(val)) totalScore += val;
    });
    totalEl.innerText = Number(totalScore.toFixed(2));
  },

  _closeCardDetail() {
    const overlay = document.getElementById('kb-detail-overlay');
    if (!overlay) return;
    overlay.classList.remove('kb-overlay-visible');
    setTimeout(() => overlay.remove(), 250);
  }
};

// ──────────────────────────────────────────────────────────
// BOOTSTRAP — Chờ DOM + GSI script cùng sẵn sàng
// ──────────────────────────────────────────────────────────
(function bootstrap() {
  let domReady = false;
  let gsiReady = false;

  function tryInit() {
    if (domReady && gsiReady) { App.init(); }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { domReady = true; tryInit(); });
  } else {
    domReady = true;
  }

  function waitForGSI() {
    if (typeof google !== 'undefined' && google?.accounts?.oauth2) { gsiReady = true; tryInit(); }
    else { setTimeout(waitForGSI, 150); }
  }
  waitForGSI();
})();
