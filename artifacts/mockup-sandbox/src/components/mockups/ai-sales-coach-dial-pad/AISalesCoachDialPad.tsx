import { useEffect, useRef, useState } from "react";
import { Delete, Phone, PhoneOff, RotateCcw } from "lucide-react";
import { Call, Device } from "@twilio/voice-sdk";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type DialPadKeyProps = {
  value: string;
  label?: string;
  onClick: (value: string) => void;
};

function DialPadKey({ value, label, onClick }: DialPadKeyProps) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-16 flex-col gap-0 rounded-2xl border-border/80 bg-background text-2xl font-semibold shadow-sm hover:bg-accent"
      onClick={() => onClick(value)}
      aria-label={`Add ${value}`}
    >
      <span>{value}</span>
      {label ? (
        <span className="text-[0.6rem] font-medium tracking-[0.2em] text-muted-foreground">
          {label}
        </span>
      ) : null}
    </Button>
  );
}

export function AISalesCoachDialPad() {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [status, setStatus] = useState<
    "Ready" | "Dialing" | "Ringing" | "Connected" | "Ended" | "Error"
  >("Ready");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [hasActiveCall, setHasActiveCall] = useState(false);
  const deviceRef = useRef<Device | null>(null);
  const activeCallRef = useRef<Call | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function initializeDevice() {
      try {
        const apiBaseUrl = import.meta.env.VITE_API_BASE_URL || "/api";
        const response = await fetch(`${apiBaseUrl}/token`, {
          method: "POST",
        });
        const data = (await response.json()) as { token?: string; error?: string };

        if (!response.ok || !data.token) {
          throw new Error(data.error || "Unable to get a Twilio access token");
        }

        if (cancelled) {
          return;
        }

        const device = new Device(data.token);
        deviceRef.current = device;

        device.on(Device.EventName.Registered, () => {
          if (!cancelled) {
            setDeviceReady(true);
            setStatus("Ready");
            setErrorMessage(null);
          }
        });
        device.on(Device.EventName.Error, (error) => {
          if (!cancelled) {
            setDeviceReady(false);
            setStatus("Error");
            setErrorMessage(error.message || "Twilio device initialization failed");
          }
        });

        await device.register();
      } catch (error) {
        if (!cancelled) {
          setStatus("Error");
          setErrorMessage(
            error instanceof Error
              ? error.message
              : "Twilio device initialization failed",
          );
        }
      }
    }

    void initializeDevice();

    return () => {
      cancelled = true;
      activeCallRef.current?.disconnect();
      activeCallRef.current = null;
      deviceRef.current?.destroy();
      deviceRef.current = null;
    };
  }, []);

  function bindCallEvents(call: Call) {
    activeCallRef.current = call;
    setHasActiveCall(true);
    setStatus("Dialing");
    setErrorMessage(null);

    call.on("ringing", () => setStatus("Ringing"));
    call.on("accept", () => setStatus("Connected"));
    call.on("disconnect", () => {
      activeCallRef.current = null;
      setHasActiveCall(false);
      setStatus("Ended");
    });
    call.on("cancel", () => {
      activeCallRef.current = null;
      setHasActiveCall(false);
      setStatus("Ended");
    });
    call.on("error", (error) => {
      activeCallRef.current = null;
      setHasActiveCall(false);
      setStatus("Error");
      setErrorMessage(error.message || "The call failed");
    });
  }

  async function handleCall() {
    if (!deviceReady || !deviceRef.current || hasActiveCall) {
      return;
    }

    if (!/^\+[1-9]\d{1,14}$/.test(phoneNumber)) {
      setStatus("Error");
      setErrorMessage("Enter a valid E.164 number, such as +14155550123");
      return;
    }

    try {
      const call = await deviceRef.current.connect({
        params: { To: phoneNumber },
      });
      bindCallEvents(call);
    } catch (error) {
      setStatus("Error");
      setErrorMessage(error instanceof Error ? error.message : "The call failed");
    }
  }

  function handleHangUp() {
    activeCallRef.current?.disconnect();
  }

  function appendDigit(value: string) {
    setPhoneNumber((current) => `${current}${value}`);
  }

  function handleInputChange(value: string) {
    const normalized = value.replace(/[^\d+]/g, "");
    setPhoneNumber(
      normalized.startsWith("+")
        ? `+${normalized.slice(1).replace(/\+/g, "")}`
        : normalized.replace(/\+/g, ""),
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <section className="w-full max-w-sm rounded-3xl border border-border/70 bg-card p-6 text-card-foreground shadow-xl shadow-black/5">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              AI Sales Coach
            </p>
            <h1 className="mt-2 text-2xl font-semibold tracking-tight">
              Dial a prospect
            </h1>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-xs font-medium">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "Error" ? "bg-destructive" : "bg-emerald-500"
              }`}
              aria-hidden="true"
            />
            <span>{status}</span>
          </div>
        </div>

        <label
          htmlFor="sales-coach-phone-number"
          className="mb-2 block text-sm font-medium text-muted-foreground"
        >
          Phone number
        </label>
        <Input
          id="sales-coach-phone-number"
          type="tel"
          inputMode="tel"
          value={phoneNumber}
          onChange={(event) => handleInputChange(event.target.value)}
          placeholder="+1 555 123 4567"
          className="h-14 rounded-2xl bg-background px-4 text-center text-xl tracking-wide"
          aria-describedby="dial-pad-status"
        />
        <p id="dial-pad-status" className="mt-2 text-center text-xs text-muted-foreground">
          {errorMessage || "Enter an E.164 number to get started"}
        </p>

        <div className="mt-5 grid grid-cols-3 gap-3">
          <DialPadKey value="1" onClick={appendDigit} />
          <DialPadKey value="2" label="ABC" onClick={appendDigit} />
          <DialPadKey value="3" label="DEF" onClick={appendDigit} />
          <DialPadKey value="4" label="GHI" onClick={appendDigit} />
          <DialPadKey value="5" label="JKL" onClick={appendDigit} />
          <DialPadKey value="6" label="MNO" onClick={appendDigit} />
          <DialPadKey value="7" label="PQRS" onClick={appendDigit} />
          <DialPadKey value="8" label="TUV" onClick={appendDigit} />
          <DialPadKey value="9" label="WXYZ" onClick={appendDigit} />
          <DialPadKey value="+" onClick={appendDigit} />
          <DialPadKey value="0" onClick={appendDigit} />
          <Button
            type="button"
            variant="outline"
            className="h-16 rounded-2xl border-border/80 bg-background shadow-sm hover:bg-accent"
            onClick={() => setPhoneNumber((current) => current.slice(0, -1))}
            aria-label="Backspace"
          >
            <Delete className="size-5" />
          </Button>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <Button
            type="button"
            variant="secondary"
            className="h-11 rounded-xl"
            onClick={() => setPhoneNumber("")}
          >
            <RotateCcw className="size-4" />
            Clear
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-11 rounded-xl"
            disabled={!hasActiveCall}
            onClick={handleHangUp}
            aria-label="Hang Up"
          >
            <PhoneOff className="size-4" />
            Hang Up
          </Button>
        </div>

        <Button
          type="button"
          className="mt-3 h-12 w-full rounded-xl"
          disabled={!deviceReady || hasActiveCall}
          onClick={() => void handleCall()}
          aria-label="Call"
        >
          <Phone className="size-4" />
          Call
        </Button>
      </section>
    </main>
  );
}