#include "audio_capture.h"
#include <vector>
#include <string>
#include <algorithm>

// ============================================================================
// ProcessEnumerator Implementation (separate file for modularity)
// ============================================================================

std::vector<ProcessInfo> ProcessEnumerator::GetCaptureableProcesses() {
    std::vector<ProcessInfo> processes;
    
    // Get all windows
    EnumWindows(EnumWindowsCallback, reinterpret_cast<LPARAM>(&processes));
    
    // Sort by process name
    std::sort(processes.begin(), processes.end(), [](const ProcessInfo& a, const ProcessInfo& b) {
        return a.processName < b.processName;
    });
    
    // Remove duplicates (same PID)
    auto last = std::unique(processes.begin(), processes.end(), [](const ProcessInfo& a, const ProcessInfo& b) {
        return a.processId == b.processId;
    });
    processes.erase(last, processes.end());
    
    return processes;
}

BOOL CALLBACK ProcessEnumerator::EnumWindowsCallback(HWND hwnd, LPARAM lParam) {
    if (!IsWindowVisibleAndValid(hwnd)) return TRUE;
    
    std::vector<ProcessInfo>* processes = reinterpret_cast<std::vector<ProcessInfo>*>(lParam);
    
    DWORD processId = 0;
    GetWindowThreadProcessId(hwnd, &processId);
    
    if (processId == 0) return TRUE;
    
    // Skip our own process
    if (processId == GetCurrentProcessId()) return TRUE;
    
    ProcessInfo info;
    info.hwnd = hwnd;
    info.processId = processId;
    info.processName = GetProcessName(processId);
    info.windowTitle = GetWindowTitle(hwnd);
    
    processes->push_back(std::move(info));
    return TRUE;
}

std::wstring ProcessEnumerator::GetProcessName(DWORD processId) {
    HANDLE hProcess = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, processId);
    if (!hProcess) return L"Unknown";
    
    WCHAR buffer[MAX_PATH];
    DWORD size = MAX_PATH;
    std::wstring name = L"Unknown";
    
    if (QueryFullProcessImageNameW(hProcess, 0, buffer, &size)) {
        // Extract just the filename
        std::wstring fullPath(buffer);
        size_t pos = fullPath.find_last_of(L"\\/");
        if (pos != std::wstring::npos) {
            name = fullPath.substr(pos + 1);
        } else {
            name = fullPath;
        }
    }
    
    CloseHandle(hProcess);
    return name;
}

std::wstring ProcessEnumerator::GetWindowTitle(HWND hwnd) {
    int length = GetWindowTextLengthW(hwnd);
    if (length == 0) return L"";
    
    std::wstring title(length + 1, L'\0');
    GetWindowTextW(hwnd, &title[0], length + 1);
    title.resize(length);
    return title;
}

bool ProcessEnumerator::IsWindowVisibleAndValid(HWND hwnd) {
    if (!IsWindowVisible(hwnd)) return false;
    if (GetWindowTextLengthW(hwnd) == 0) return false;
    
    // Check if it's a real window (not a tool window, etc.)
    LONG_PTR exStyle = GetWindowLongPtr(hwnd, GWL_EXSTYLE);
    if (exStyle & WS_EX_TOOLWINDOW) return false;
    if (exStyle & WS_EX_NOACTIVATE) return false;
    
    RECT rect;
    GetWindowRect(hwnd, &rect);
    if (rect.right - rect.left < 100 || rect.bottom - rect.top < 100) return false;
    
    return true;
}