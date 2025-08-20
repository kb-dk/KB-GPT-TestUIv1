import { useContext, useState } from 'react';
import { FontIcon, Stack, TextField } from '@fluentui/react';
import { SendRegular } from '@fluentui/react-icons';
import mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.mjs?url';

import Send from '../../assets/Send.svg';

import styles from './QuestionInput.module.css';
import { ChatMessage } from '../../api';
import { AppStateContext } from '../../state/AppProvider';
import { resizeImage } from '../../utils/resizeImage';

// Sæt worker-stien for pdf.js til den lokalt importerede fil
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

// Erklærer XLSX som en global variabel for at undgå TypeScript-fejl.
// Biblioteket skal indlæses via et <script>-tag i din HTML-fil.
declare var XLSX: any;

interface Props {
  onSend: (question: ChatMessage['content'], id?: string) => void;
  disabled: boolean;
  placeholder?: string;
  clearOnSend?: boolean;
  conversationId?: string;
}

export const QuestionInput = ({ onSend, disabled, placeholder, clearOnSend, conversationId }: Props) => {
  const [question, setQuestion] = useState<string>('');
  const [base64Image, setBase64Image] = useState<string | null>(null);
  const [attachedTextFile, setAttachedTextFile] = useState<{ name: string; content: string } | null>(null);

  const appStateContext = useContext(AppStateContext);
  const OYD_ENABLED = appStateContext?.state.frontendSettings?.oyd_enabled || false;

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (file) {
      const fileType = file.type;

      setBase64Image(null);
      setAttachedTextFile(null);
      
      try {
        if (fileType.startsWith('image/')) {
          // Behandler billedfiler ved at konvertere dem til Base64
          await convertToBase64(file);
        }
        else if (
          fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || // .docx
          fileType === 'application/msword' || // .doc
          fileType === 'application/vnd.oasis.opendocument.text' || // .odt
          fileType === 'application/rtf' || // .rtf
          fileType === 'text/plain' // .txt
        ) {
          // Behandler forskellige tekstbaserede dokumenter
          const reader = new FileReader();
          reader.onload = async (event) => {
            if (event.target && event.target.result) {
              if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileType === 'application/msword') {
                const result = await mammoth.extractRawText({ arrayBuffer: event.target.result as ArrayBuffer });
                setAttachedTextFile({ name: file.name, content: result.value });
              } else {
                setAttachedTextFile({ name: file.name, content: event.target.result as string });
              }
            }
          };
          // mammoth kræver en ArrayBuffer, mens de andre kan læses som tekst.
          if (fileType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || fileType === 'application/msword') {
            reader.readAsArrayBuffer(file);
          } else {
            reader.readAsText(file);
          }
        }
        else if (fileType === 'application/pdf') {
          // Behandler PDF-filer
          const reader = new FileReader();
          reader.onload = async (event) => {
            if (event.target && event.target.result) {
              const arrayBuffer = event.target.result as ArrayBuffer;
              try {
                const pdfDocument = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
                let fullText = '';
                for (let i = 1; i <= pdfDocument.numPages; i++) {
                  const page = await pdfDocument.getPage(i);
                  const textContent = await page.getTextContent();
                  const pageText = textContent.items.map((item: any) => item.str).join(' ');
                  fullText += pageText + '\n';
                }
                setAttachedTextFile({ name: file.name, content: fullText });
              } catch (err) {
                console.error('Error parsing PDF:', err);
              }
            }
          };
          reader.readAsArrayBuffer(file);
        }
        else if (fileType === 'text/csv' || 
                 fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || // .xlsx
                 fileType === 'application/vnd.ms-excel' || // .xls
                 fileType === 'application/vnd.oasis.opendocument.spreadsheet') { // .ods
          // Behandler forskellige regneark
          const reader = new FileReader();
          reader.onload = (event) => {
            let textContent = '';
            if (fileType === 'text/csv') {
                textContent = event.target?.result as string;
            } else {
                const data = new Uint8Array(event.target?.result as ArrayBuffer);
                // Vi bruger den globale XLSX-variabel, som forventes at være defineret af et CDN-script.
                const workbook = XLSX.read(data, { type: 'array' });
                
                workbook.SheetNames.forEach((sheetName: string) => {
                  const worksheet = workbook.Sheets[sheetName];
                  textContent += `Sheet: ${sheetName}\n`;
                  textContent += XLSX.utils.sheet_to_csv(worksheet);
                  textContent += `\n\n`;
                });
            }
            setAttachedTextFile({ name: file.name, content: textContent });
          };
          if (fileType === 'text/csv') {
            reader.readAsText(file);
          } else {
            reader.readAsArrayBuffer(file);
          }
        }
        else {
          console.warn('Unsupported file type:', fileType);
        }
      } catch (error) {
        console.error('Failed to process file:', error);
      }
    }
  };

  const convertToBase64 = async (file: Blob) => {
    try {
      const resizedBase64 = await resizeImage(file, 800, 800);
      setBase64Image(resizedBase64);
    } catch (error) {
      console.error('Error:', error);
    }
  };

  const sendQuestion = () => {
    // Validerer om der er et spørgsmål, et billede eller en vedhæftet fil, før beskeden sendes
    if (disabled || (!question.trim() && !base64Image && !attachedTextFile)) {
      return;
    }

    let finalQuestion: ChatMessage['content'] = question.toString();
    
    if (base64Image) {
      // For billeder sendes et array med tekst og billeddata.
      finalQuestion = [{ type: 'text', text: question }, { type: 'image_url', image_url: { url: base64Image } }];
    } 
    else if (attachedTextFile) {
      // For tekstfiler kombineres spørgsmålet og filindholdet til én streng.
      // Dette er den nuværende løsning for at overføre indholdet til AI'en.
      finalQuestion = `${question}\n\n[Vedhæftet fil: ${attachedTextFile.name}]\n\n${attachedTextFile.content}`;
    }

    if (conversationId && finalQuestion !== undefined) {
      onSend(finalQuestion, conversationId);
      setBase64Image(null);
      setAttachedTextFile(null);
    } else {
      onSend(finalQuestion);
      setBase64Image(null);
      setAttachedTextFile(null);
    }

    if (clearOnSend) {
      setQuestion('');
    }
  };

  const onEnterPress = (ev: React.KeyboardEvent<Element>) => {
    if (ev.key === 'Enter' && !ev.shiftKey && !(ev.nativeEvent?.isComposing === true)) {
      ev.preventDefault();
      sendQuestion();
    }
  };

  const onQuestionChange = (_ev: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>, newValue?: string) => {
    setQuestion(newValue || '');
  };

  const sendQuestionDisabled = disabled || (!question.trim() && !base64Image && !attachedTextFile);

  const clearAttachedFile = () => {
    setBase64Image(null);
    setAttachedTextFile(null);
  };

  return (
    <Stack horizontal className={styles.questionInputContainer}>
      <TextField
        className={styles.questionInputTextArea}
        placeholder={placeholder}
        multiline
        resizable={false}
        borderless
        value={question}
        onChange={onQuestionChange}
        onKeyDown={onEnterPress}
      />
      {!OYD_ENABLED && (
        <div className={styles.fileInputContainer}>
          <input
            type="file"
            id="fileInput"
            onChange={handleFileUpload}
            accept="image/*, .txt, .doc, .odt, .rtf, .pdf, .csv, .xlsx, .xls, .ods"
            className={styles.fileInput}
          />
          <label htmlFor="fileInput" className={styles.fileLabel} aria-label='Upload file'>
            <FontIcon
              className={styles.fileIcon}
              // Ændrer ikonet til "Attach"
              iconName={'Attach'}
              aria-label='Upload file'
            />
          </label>
        </div>
      )}
      
      {/* Viser vedhæftet indhold (billede eller fil) */}
      {base64Image && <img className={styles.uploadedImage} src={base64Image} alt="Uploaded Preview" />}
      {attachedTextFile && (
        <Stack horizontal className={styles.attachedFileContainer}>
          <FontIcon iconName="Document" className={styles.attachedFileIcon} />
          <span className={styles.attachedFileName}>{attachedTextFile.name}</span>
          <FontIcon iconName="Cancel" className={styles.removeAttachedFile} onClick={clearAttachedFile} />
        </Stack>
      )}
      
      <div
        className={styles.questionInputSendButtonContainer}
        role="button"
        tabIndex={0}
        aria-label="Ask question button"
        onClick={sendQuestion}
        onKeyDown={e => (e.key === 'Enter' || e.key === ' ' ? sendQuestion() : null)}>
        {sendQuestionDisabled ? (
          <SendRegular className={styles.questionInputSendButtonDisabled} />
        ) : (
          <img src={Send} className={styles.questionInputSendButton} alt="Send Button" />
        )}
      </div>
      <div className={styles.questionInputBottomBorder} />
    </Stack>
  );
};
