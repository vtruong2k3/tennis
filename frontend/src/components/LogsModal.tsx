import React from 'react';
import { X, ShieldCheck, Camera, Terminal } from 'lucide-react';

interface LogsModalProps {
  type: 'logs' | 'calibration' | 'privacy' | null;
  onClose: () => void;
}

export const LogsModal: React.FC<LogsModalProps> = ({ type, onClose }) => {
  if (!type) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-[#111624] border border-white/20 rounded-xl w-full max-w-2xl max-h-[85vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 px-6 border-b border-white/10 flex items-center justify-between bg-[#0a0f1d]">
          <div className="flex items-center gap-2.5">
            {type === 'logs' && <Terminal className="w-5 h-5 text-[#4cd7f6]" />}
            {type === 'calibration' && <Camera className="w-5 h-5 text-[#caf300]" />}
            {type === 'privacy' && <ShieldCheck className="w-5 h-5 text-emerald-400" />}

            <h3 className="text-white text-base font-bold">
              {type === 'logs' && 'Nhật Ký Hệ Thống Telemetry (System Logs)'}
              {type === 'calibration' && 'Cân Chỉnh Ống Kính Camera Hawk-Eye (Calibration)'}
              {type === 'privacy' && 'Quy Chuẩn Liên Đoàn & Bảo Mật Dữ Liệu'}
            </h3>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto font-mono text-xs text-[#94a3b8] space-y-4 bg-[#070b13]">
          {type === 'logs' && (
            <div className="space-y-2">
              <div className="text-[#caf300]">[6-FINALS-CQ16] [INIT] Hawk-Eye Optic Core v2.4 initialized.</div>
              <div className="text-[#4cd7f6]">[CAM-01..12] 12 Optical high-speed cameras locked at 240.0 fps.</div>
              <div className="text-white/80">[NET_SENSOR] Optical line crossing triangulation active (error margin &lt; 2mm).</div>
              <div className="text-white/80">[RALLY #01..#12] Successfully encoded and synchronized.</div>
              <div className="text-[#caf300] font-bold">[RALLY #13] PEAK VELOCITY RECORD DETECTED: 253.6 KM/H. IMPACT VERIFIED IN-COURT.</div>
              <div className="text-white/80">[RALLY #16] Match point locked. Final score confirmation validated.</div>
              <div className="text-emerald-400">[STATUS] Session closed cleanly. All 85 shots hashed with SHA-256 for audit.</div>
            </div>
          )}

          {type === 'calibration' && (
            <div className="space-y-3">
              <p className="text-white font-semibold">Tình trạng cảm biến 12 Camera sân thi đấu:</p>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-2 bg-white/5 rounded border border-white/10 flex justify-between">
                  <span>CAM 01 (Baseline P1):</span>
                  <span className="text-emerald-400 font-bold">CALIBRATED 0.1mm</span>
                </div>
                <div className="p-2 bg-white/5 rounded border border-white/10 flex justify-between">
                  <span>CAM 02 (Baseline P2):</span>
                  <span className="text-emerald-400 font-bold">CALIBRATED 0.1mm</span>
                </div>
                <div className="p-2 bg-white/5 rounded border border-white/10 flex justify-between">
                  <span>CAM 03..06 (Hình phát bóng):</span>
                  <span className="text-emerald-400 font-bold">SYNCHRONIZED 240fps</span>
                </div>
                <div className="p-2 bg-white/5 rounded border border-white/10 flex justify-between">
                  <span>CAM 07..12 (Side Arcs):</span>
                  <span className="text-emerald-400 font-bold">LOCK 3D VECTOR</span>
                </div>
              </div>
              <p className="text-xs text-[#718096] pt-2">
                Hệ thống tự động bù trừ ánh sáng đèn nhà thi đấu và độ giãn nở nhiệt mặt sân acrylic.
              </p>
            </div>
          )}

          {type === 'privacy' && (
            <div className="space-y-3 text-xs leading-relaxed">
              <p className="text-white font-semibold">Quy Chuẩn Dữ Liệu Thi Đấu Tennis Quốc Tế:</p>
              <p>
                Dữ liệu quang học và vận tốc bóng được bảo chứng bởi hệ thống Telemetry I-SPORTS, tuân thủ hoàn toàn quy chuẩn trọng tài của Liên đoàn Tennis Quốc tế (ITF).
              </p>
              <p>
                Mọi chỉ số tốc độ bóng được tính toán tại điểm chạm vợt đầu tiên và điểm tiếp xúc mặt sân (In-Court Impact) nhằm phục vụ công tác phát sóng truyền hình trực tiếp và phân tích chiến thuật cấp cao.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 px-6 border-t border-white/10 bg-[#0a0f1d] flex justify-end">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-white/10 hover:bg-white/20 text-white font-mono text-xs transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
