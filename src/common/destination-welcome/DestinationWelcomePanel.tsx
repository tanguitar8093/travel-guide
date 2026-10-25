import type { OsmDatasetId } from '../../geo/osm-datasets'
import { TourGuideAnimation } from '../TourGuideAnimation'
import { TaiwanLoginScene } from '../../auth/TaiwanLoginScene'
import { OkinawaLoginScene } from '../../auth/OkinawaLoginScene'
import { JapanLoginScene } from '../../auth/JapanLoginScene'
import '../../auth/AuthGate.css'

export function DestinationWelcomePanel({ dataset, welcome = true, ready = true, message = "載入中" }: { dataset?: OsmDatasetId; welcome?: boolean; ready?: boolean; message?: string }) {
  const taiwan = dataset === "taiwan";
  const japan = dataset === "japan";
  return (
      <div className="auth-shell">
        <section
          className="auth-panel auth-panel-loading"
          role="status"
          aria-label={welcome ? '旅行迎賓畫面' : '正在確認登入狀態'}
          aria-live="polite"
        >
          {welcome ? (
            <div className="auth-island-heading">
              <p className="auth-eyebrow">旅圖 · TripMap</p>
              <p className="auth-island-destination">
                <span>{japan ? "日本" : taiwan ? "台灣" : "沖繩"}</span>
                <span className="auth-island-separator">·</span>
                <span className="auth-island-english" lang="en">{japan ? "Japan" : taiwan ? "Taiwan" : "Okinawa"}</span>
              </p>
            </div>
          ) : (
            <p className="auth-eyebrow">旅圖 · TripMap</p>
          )}
          {welcome ? (
            japan ? <JapanLoginScene /> : taiwan ? <TaiwanLoginScene /> : <OkinawaLoginScene />
          ) : (
            <TourGuideAnimation />
          )}
          <p className="auth-loading-caption">
            {welcome && ready
              ? "準備出發"
              : message}
            <span className="auth-loading-dots" aria-hidden="true">
              <span>.</span>
              <span>.</span>
              <span>.</span>
            </span>
          </p>
          {welcome && (
            <p className="auth-tagline" lang="en">
              Your Journey, Your Map.
            </p>
          )}

        </section>
      </div>
  );
}
