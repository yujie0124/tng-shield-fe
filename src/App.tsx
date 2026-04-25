import { Routes, Route, useLocation } from 'react-router-dom';
import { BottomNav, ProtectedRoute, ReviewToast } from './components';
import {
  Login,
  Home,
  Reload,
  Transfer,
  TransferPending,
  Scan,
  History,
  Profile,
  Shield,
  ShieldReview,
} from './pages';

const HIDE_NAV_ON: string[] = ['/login'];

export default function App() {
  const location = useLocation();
  const showNav = !HIDE_NAV_ON.includes(location.pathname);

  return (
    <div className="app-shell">
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Home />
            </ProtectedRoute>
          }
        />
        <Route
          path="/reload"
          element={
            <ProtectedRoute>
              <Reload />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transfer"
          element={
            <ProtectedRoute>
              <Transfer />
            </ProtectedRoute>
          }
        />
        <Route
          path="/transfer/pending/:id"
          element={
            <ProtectedRoute>
              <TransferPending />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shield"
          element={
            <ProtectedRoute>
              <Shield />
            </ProtectedRoute>
          }
        />
        <Route
          path="/shield/review/:id"
          element={
            <ProtectedRoute>
              <ShieldReview />
            </ProtectedRoute>
          }
        />
        <Route
          path="/scan"
          element={
            <ProtectedRoute>
              <Scan />
            </ProtectedRoute>
          }
        />
        <Route
          path="/history"
          element={
            <ProtectedRoute>
              <History />
            </ProtectedRoute>
          }
        />
        <Route
          path="/profile"
          element={
            <ProtectedRoute>
              <Profile />
            </ProtectedRoute>
          }
        />
      </Routes>
      {showNav && <ReviewToast />}
      {showNav && <BottomNav />}
    </div>
  );
}
