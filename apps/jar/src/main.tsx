// (c) Copyright 2026 Scott Morris
// SPDX-License-Identifier: Apache-2.0 OR MIT

import '@fontsource/nunito/400.css';
import '@fontsource/nunito/700.css';

import React from 'react';
import ReactDOM from 'react-dom/client';

import { App } from './App';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
