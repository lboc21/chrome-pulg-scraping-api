import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './styles.css';

const container = document.getElementById('root');
if (!container) throw new Error('未找到 #root 容器');

createRoot(container).render(
  <StrictMode>
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          fontSize: 12,
          borderRadius: 4,
          colorPrimary: '#1677ff'
        },
        components: {
          Table: { cellPaddingBlockSM: 4, cellPaddingInlineSM: 8, headerBg: '#fafafa' }
        }
      }}
    >
      <App />
    </ConfigProvider>
  </StrictMode>
);
