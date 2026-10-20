import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useAuth } from "../../auth/useAuth";
import { useDatabaseMode } from "../../database";
import type {
  CollaborationDetails,
  CollaborationList,
  TripMemberRole,
} from "../../database";
import { tripCollaborationController } from "./trip-collaboration.controller";
import "./TripCollaborationPanel.css";
import { sharedTripEditingEnabled } from "../../database/shared-trip.types";
import { sharedTripController } from "./shared-trip.controller";

const roleLabels = { viewer: "唯讀", editor: "可編輯", owner: "擁有者" };

interface Props {
  preferredTripId?: string;
  onClose(tripId?: string): void;
}

export function TripCollaborationPanel({ preferredTripId, onClose }: Props) {
  const { user } = useAuth();
  const mode = useDatabaseMode();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const firstInputRef = useRef<HTMLSelectElement>(null);
  const inviteInputRef = useRef<HTMLInputElement>(null);
  const [listing, setListing] = useState<CollaborationList>();
  const [details, setDetails] = useState<CollaborationDetails>();
  const [enabledTripIds, setEnabledTripIds] = useState<string[]>([]);
  const [tripId, setTripId] = useState(preferredTripId ?? "");
  const [invitee, setInvitee] = useState("");
  const [role, setRole] = useState<TripMemberRole>("viewer");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generation = useRef(0);
  const actionActive = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    };
  }, []);

  const load = useCallback(
    async (preferred: string, currentGeneration: number) => {
      const [next, shared] = await Promise.all([
        tripCollaborationController.list(),
        sharedTripEditingEnabled
          ? sharedTripController.list()
          : Promise.resolve([]),
      ]);
      if (generation.current !== currentGeneration) return;
      setListing(next);
      setEnabledTripIds(
        shared.filter((row) => row.document).map((row) => row.id),
      );
      const nextTripId = next.trips.some((trip) => trip.id === preferred)
        ? preferred
        : (next.trips[0]?.id ?? "");
      setTripId(nextTripId);
      setDetails(undefined);
      if (nextTripId) {
        const nextDetails =
          await tripCollaborationController.details(nextTripId);
        if (generation.current === currentGeneration) setDetails(nextDetails);
      }
    },
    [],
  );

  useEffect(() => {
    const current = ++generation.current;
    setLoading(true);
    setBusy(false);
    setListing(undefined);
    setDetails(undefined);
    setInvitee("");
    setRole("viewer");
    setError("");
    void load(preferredTripId ?? "", current)
      .catch((cause: unknown) => {
        if (generation.current === current)
          setError(
            cause instanceof Error ? cause.message : "載入協作資料失敗。",
          );
      })
      .finally(() => {
        if (generation.current === current) setLoading(false);
      });
    return () => {
      generation.current += 1;
    };
  }, [load, preferredTripId, user?.id, mode]);

  useEffect(() => {
    if (!loading && listing)
      (inviteInputRef.current ?? firstInputRef.current)?.focus();
  }, [loading, listing]);

  async function changeTrip(nextTripId: string) {
    const current = ++generation.current;
    setTripId(nextTripId);
    setDetails(undefined);
    setError("");
    setNotice("");
    setLoading(true);
    try {
      const next = await tripCollaborationController.details(nextTripId);
      if (generation.current === current) setDetails(next);
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause.message : "載入分享行程失敗。");
    } finally {
      if (generation.current === current) setLoading(false);
    }
  }

  async function run(action: () => Promise<void>, message: string) {
    if (actionActive.current) return;
    actionActive.current = true;
    const current = ++generation.current;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (generation.current !== current) return;
      setNotice(message);
      try {
        await load(tripId, current);
      } catch (cause) {
        if (generation.current === current) {
          setDetails(undefined);
          setError(
            `操作已完成，但重新載入失敗：${cause instanceof Error ? cause.message : "請重新整理確認最新狀態。"}`,
          );
        }
      }
    } catch (cause) {
      if (generation.current === current)
        setError(cause instanceof Error ? cause.message : "協作操作失敗。");
    } finally {
      actionActive.current = false;
      if (generation.current === current) setBusy(false);
    }
  }

  function submitInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!details) return;
    void run(async () => {
      await tripCollaborationController.invite(details.trip.id, invitee, role);
      setInvitee("");
    }, "站內邀請已送出。請對方接受邀請。");
  }

  const pendingInvitations =
    listing?.invitations.filter(
      (invitation) =>
        !invitation.acceptedAt &&
        !invitation.revokedAt &&
        Date.parse(invitation.expiresAt) > Date.now(),
    ) ?? [];
  const canManage = details?.trip.access === "owner";
  const places = new Map(details?.places.map((place) => [place.id, place]));

  return (
    <dialog
      ref={dialogRef}
      className="trip-collaboration-dialog"
      aria-labelledby="trip-collaboration-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose(tripId);
      }}
    >
      <header className="trip-collaboration-heading">
        <h2 id="trip-collaboration-title">
          {sharedTripEditingEnabled ? "行程協作管理" : "行程協作預覽"}
        </h2>
        <div className="trip-collaboration-heading-actions">
          {details &&
            sharedTripEditingEnabled &&
            canManage &&
            (enabledTripIds.includes(details.trip.id) ? (
              <button
                type="button"
                className="itinerary-delete"
                disabled={busy || loading}
                onClick={() => {
                  if (
                    !window.confirm(
                      "確定取消此行程的共享？會撤銷所有成員與邀請，並將最新共同編輯內容保留為你的個人行程。",
                    )
                  )
                    return;
                  void run(
                    () => sharedTripController.cancel(details.trip.id),
                    "已結束共享；最新共同編輯內容已保留為個人行程。",
                  );
                }}
              >
                結束協作
              </button>
            ) : (
              <button
                type="button"
                className="itinerary-primary"
                disabled={busy || loading}
                onClick={() => {
                  if (
                    !window.confirm(
                      "確定啟用此行程的共同編輯？行程會留在原本的清單，成員可從同一套行程介面使用。",
                    )
                  )
                    return;
                  void run(async () => {
                    await sharedTripController.enable(details.trip.id);
                    await sharedTripController.refresh();
                  }, "共同編輯已啟用。關閉視窗後，直接使用原本的行程畫面。");
                }}
              >
                啟用協作
              </button>
            ))}
          <button
            type="button"
            className="itinerary-secondary"
            disabled={busy}
            onClick={() => onClose(tripId)}
          >
            關閉
          </button>
        </div>
      </header>
      <p className="trip-collaboration-account">我的 Email：{user?.email}</p>
      {error && (
        <p className="itinerary-feedback itinerary-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="itinerary-feedback itinerary-success" role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">正在載入協作資料…</p>}
      {error && !busy && (
        <button
          type="button"
          className="itinerary-secondary"
          onClick={() => void run(async () => {}, "已重新載入協作資料。")}
        >
          重新載入
        </button>
      )}
      {pendingInvitations.length > 0 && (
        <section aria-label="收到的行程邀請">
          <h3>收到的邀請</h3>
          <ul className="trip-collaboration-list">
            {pendingInvitations.map((invitation) => (
              <li key={invitation.id}>
                <span>
                  {invitation.tripName} · {roleLabels[invitation.role]}
                </span>
                <button
                  type="button"
                  className="itinerary-primary"
                  disabled={busy || loading}
                  onClick={() =>
                    void run(
                      () =>
                        tripCollaborationController.accept(
                          invitation.tripId,
                          invitation.id,
                        ),
                      "已接受邀請。",
                    )
                  }
                >
                  接受邀請
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {listing && (
        <label className="itinerary-field">
          <span>選擇雲端行程</span>
          <select
            ref={firstInputRef}
            value={tripId}
            disabled={busy || loading || !listing.trips.length}
            onChange={(event) => void changeTrip(event.target.value)}
          >
            {!listing.trips.length && (
              <option value="">沒有可存取的雲端行程</option>
            )}
            {listing.trips.map((trip) => (
              <option key={trip.id} value={trip.id}>
                {trip.name} · {roleLabels[trip.access]}
              </option>
            ))}
          </select>
        </label>
      )}
      {details && (
        <>
          <p>
            {details.trip.startDate} — {details.trip.endDate} ·{" "}
            {roleLabels[details.trip.access]}
          </p>
          {canManage && (
            <form className="trip-collaboration-invite" onSubmit={submitInvite}>
              <h3>邀請</h3>
              <label className="itinerary-field">
                <span>對方 Email</span>
                <input
                  ref={inviteInputRef}
                  type="email"
                  required
                  maxLength={254}
                  value={invitee}
                  disabled={busy || loading}
                  onChange={(event) => setInvitee(event.target.value)}
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                />
              </label>
              <label className="itinerary-field">
                <span>接受後的權限</span>
                <select
                  value={role}
                  disabled={busy || loading}
                  onChange={(event) =>
                    setRole(
                      event.target.value === "editor" ? "editor" : "viewer",
                    )
                  }
                >
                  <option value="viewer">唯讀</option>
                  <option value="editor">
                    {sharedTripEditingEnabled
                      ? "可編輯（擁有者啟用協作後生效）"
                      : "可編輯（共同編輯介面尚未開放）"}
                  </option>
                </select>
              </label>
              <button
                type="submit"
                className="itinerary-primary"
                disabled={busy || loading || !invitee.trim()}
              >
                送出邀請
              </button>
            </form>
          )}
          <section aria-label="行程成員">
            <h3>行程成員</h3>
            <p>擁有者：{details.trip.ownerEmail ?? "行程擁有者"}</p>
            <ul className="trip-collaboration-list">
              {details.members.map((member) => (
                <li key={member.userId}>
                  <span>{member.email ?? "行程成員"}</span>
                  {canManage ? (
                    <>
                      <select
                        aria-label={`${member.email ?? "行程成員"} 的權限`}
                        value={member.role}
                        disabled={busy || loading}
                        onChange={(event) =>
                          void run(
                            () =>
                              tripCollaborationController.setMember(
                                details.trip.id,
                                member.userId,
                                event.target.value === "editor"
                                  ? "editor"
                                  : "viewer",
                              ),
                            "成員權限已更新。",
                          )
                        }
                      >
                        <option value="viewer">唯讀</option>
                        <option value="editor">可編輯</option>
                      </select>
                      <button
                        type="button"
                        className="itinerary-delete"
                        disabled={busy || loading}
                        onClick={() => {
                          if (
                            window.confirm("確定移除此成員的行程存取權限？")
                          ) {
                            void run(
                              () =>
                                tripCollaborationController.removeMember(
                                  details.trip.id,
                                  member.userId,
                                ),
                              "已移除成員。",
                            );
                          }
                        }}
                      >
                        移除
                      </button>
                    </>
                  ) : (
                    <span>{roleLabels[member.role]}</span>
                  )}
                </li>
              ))}
            </ul>
            {!canManage && (
              <button
                type="button"
                className="itinerary-delete"
                disabled={busy || loading}
                onClick={() => {
                  if (
                    window.confirm(
                      "確定退出這個協作行程？需要重新受邀才能再次加入。",
                    )
                  ) {
                    void run(
                      () => tripCollaborationController.leave(details.trip.id),
                      "已退出行程。",
                    );
                  }
                }}
              >
                退出行程
              </button>
            )}
          </section>
          {canManage && details.invitations.length > 0 && (
            <section aria-label="送出的邀請">
              <h3>送出的邀請</h3>
              <ul className="trip-collaboration-list">
                {details.invitations.map((invitation) => (
                  <li key={invitation.id}>
                    <span>{invitation.inviteeEmail ?? "受邀帳號"}</span>
                    <span>
                      {roleLabels[invitation.role]} ·{" "}
                      {invitation.revokedAt
                        ? "已撤銷"
                        : invitation.acceptedAt
                          ? "已接受"
                          : Date.parse(invitation.expiresAt) <= Date.now()
                            ? "已過期"
                            : "待接受"}
                    </span>
                    {!invitation.acceptedAt && !invitation.revokedAt && (
                      <button
                        type="button"
                        className="itinerary-secondary"
                        disabled={busy || loading}
                        onClick={() =>
                          void run(
                            () =>
                              tripCollaborationController.revokeInvitation(
                                details.trip.id,
                                invitation.id,
                              ),
                            "邀請已撤銷。",
                          )
                        }
                      >
                        撤銷
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {!sharedTripEditingEnabled && (
            <section aria-label="共享行程唯讀預覽">
              <h3>行程內容（唯讀）</h3>
              {!details.items.length && <p>這趟行程尚未安排地點。</p>}
              <ol className="trip-collaboration-items">
                {[...details.items]
                  .sort(
                    (left, right) =>
                      left.date.localeCompare(right.date) ||
                      left.order - right.order,
                  )
                  .map((item) => (
                    <li key={item.id}>
                      <strong>
                        {item.date} {item.arrivalTime ?? ""} ·{" "}
                        {places.get(item.placeId)?.name ?? "無法取得地點名稱"}
                      </strong>
                      {item.durationMinutes !== undefined && (
                        <span>停留 {item.durationMinutes} 分鐘</span>
                      )}
                      {item.note && <p>{item.note}</p>}
                    </li>
                  ))}
              </ol>
              <p>只顯示此行程安排的地點，不提供私人收藏筆記或標籤。</p>
            </section>
          )}
        </>
      )}
    </dialog>
  );
}
