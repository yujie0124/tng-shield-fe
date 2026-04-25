import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Amplify } from 'aws-amplify';
import App from './App';
import { AuthProvider } from './context/AuthContext';
import { initDb } from './services/mockBackend';
import outputs from '../amplify_outputs.json';
import './styles/global.css';

Amplify.configure(outputs);

const rootEl = document.getElementById('root')!;
const root = ReactDOM.createRoot(rootEl);

root.render(
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100vh',
      color: '#6B7785',
      fontFamily: '-apple-system, BlinkMacSystemFont, sans-serif',
      fontSize: 14,
    }}
  >
    Loading shared store…
  </div>,
);

initDb()
  .catch((err) => {
    console.error('Failed to initialise shared store', err);
  })
  .finally(() => {
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <AuthProvider>
            <App />
          </AuthProvider>
        </BrowserRouter>
      </React.StrictMode>,
    );
  });
