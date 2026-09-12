# Email-Yalis 邮件资产可视化管理系统

> **基于 Gmail 官方 REST API 的高性能、私密、本地化全量邮件资产挖掘与可视化平台**

---

## 🌟 核心特性

- 🔒 **隐私至上 (Local-First)**：所有邮件、Token、解析台账与附件均持久化在本地 SQLite 与文件系统，零三方云端依赖。
- ⚡ **Gmail Batch API 极速同步**：通过 Google Batch HTTP 管道技术，单次往返请求 50~100 封邮件，提速数十倍；结合 `historyId` 实现后续秒级增量同步。
- 📊 **五大维度可视化看板**：
  1. **总览监控大屏**：邮件收发活跃热力图、SaaS 类别占比环形图、财务月度订阅支出统计；
  2. **数字资产与 SaaS 台账**：自动识别由该邮箱注册的 200+ 主流开发/办公/AI平台与经常性扣费项目，支持一键导出 CSV；
  3. **附件文件资产中心**：集中索引与分类（PDF合同、发票账单、Excel报表、设计稿与工程备份），支持一键定位原始邮件；
  4. **人脉关系网络图谱**：基于 ECharts 力导向拓扑分析，直观展示往来频繁的联系人与企业群落；
  5. **全能检索与双栏阅读器**：内置 SQLite FTS5 中英文全文搜索引擎，支持富文本/纯文本切换查看。
- 👥 **多账号并行管理**：支持绑定多个 Gmail 邮箱，支持全局聚合看板与单账号精准下钻。
- 🧪 **无缝演示沙箱**：内置一键载入演示数据功能，无需等待 Google Cloud 控制台审核，开箱即可体验全套大屏与搜索。

---

## 🚀 极速启动

### 方式一：双击一键启动 (推荐)
直接双击项目根目录下的 **`start.bat`**，系统将自动启动后端服务与前端界面，并在浏览器中打开：
- 前端控制台：`http://localhost:5173`
- 后端 API 文档：`http://localhost:8008/docs`

### 方式二：手动命令行启动

**启动后端 (FastAPI):**
```bash
cd backend
python -m pip install -r requirements.txt
python run.py
```

**启动前端 (Vite + React):**
```bash
cd frontend
npm install
npm run dev
```

---

## 🔑 Google Cloud OAuth 2.0 配置向导

要接入您真实的 Gmail 邮箱进行同步，请按以下步骤创建免费凭据：

1. 打开 [Google Cloud Console](https://console.cloud.google.com/)，新建一个项目（如 `Email-Yalis`）。
2. 在左侧菜单进入 **API 和服务** &rarr; **库**，搜索并启用 **Gmail API**。
3. 进入 **OAuth 同意屏幕**：
   - 用户类型选择 **外部 (External)**；
   - 填写应用名称（如 `Email-Yalis`）与您的邮箱；
   - 在「测试用户」中添加您打算同步的 Gmail 邮箱。
4. 进入 **凭据 (Credentials)** 页面：
   - 点击 **创建凭据** &rarr; **OAuth 客户端 ID**；
   - 应用类型选择 **Web 应用**；
   - 在 **已获授权的重定向 URI** 中添加：
     `http://localhost:8008/api/auth/callback`
   - 点击创建并**下载 JSON 凭据文件**。
5. 打开 Email-Yalis 网页，进入 **「系统与授权」** 页面，直接将下载的 JSON 文件拖拽上传即可！

---

## 🛠️ 技术架构

```
Email-Yalis/
├── backend/                  # Python FastAPI 后端
│   ├── app/
│   │   ├── config.py         # 全局配置与路径
│   │   ├── database.py       # SQLite 连接与 FTS5 全文索引触发器
│   │   ├── schemas.py        # Pydantic 数据规范
│   │   ├── services/
│   │   │   ├── gmail_auth.py       # Google OAuth2 流程与 Token 自动续期
│   │   │   ├── gmail_sync.py       # Batch HTTP 批量同步与 SSE 实时进度
│   │   │   ├── asset_extractor.py  # 规则模式资产挖掘引擎
│   │   │   ├── stats_service.py    # 大屏多维聚合统计与拓扑图谱
│   │   │   └── demo_data.py        # 演示沙箱数据生成器
│   │   └── routers/                # REST API 路由层
│   └── run.py
├── frontend/                 # React 18 + Vite + TailwindCSS + ECharts 前端
│   ├── src/
│   │   ├── api/client.js     # API 客户端封装
│   │   ├── components/       # 导航栏与进度弹窗
│   │   └── pages/            # 五大可视化页面与系统设置
├── data/                     # 本地持久化数据目录 (自动生成)
│   ├── email_assets.db       # SQLite 数据库文件 (包含 FTS5 虚拟表)
│   └── attachments/          # 本地附件去重归档目录
├── start.bat                 # Windows 一键全量启动脚本
├── run_backend.bat           # 后端单独启动脚本
└── run_frontend.bat          # 前端单独启动脚本
```
